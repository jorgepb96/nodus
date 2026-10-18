// Absolute finger positions from the Mac trackpad, for drawing a signature with
// a finger. The cursor only reports relative motion; the finger's place on the
// surface comes from MultitouchSupport, which macOS uses for its own trackpad
// signatures. The framework is private, so it is opened at run time: a Mac
// without it simply reports that absolute input is unavailable.
#include <CoreFoundation/CoreFoundation.h>
#include <dlfcn.h>
#include <mutex>
#include <node_api.h>

namespace {
struct Point { float x, y; };
struct Vector { Point position, velocity; };
// The frame layout every MultitouchSupport client relies on (96 bytes).
struct Touch {
  int frame;
  double timestamp;
  int identifier, state, fingerId, handId;
  Vector normalized;
  float size;
  int zero1;
  float angle, majorAxis, minorAxis;
  Vector millimeters;
  int zero2[2];
  float density;
};
static_assert(sizeof(Touch) == 96, "MultitouchSupport frame layout");

using Device = void *;
using FrameCallback = int (*)(Device, Touch *, int, double, int);
using CreateList = CFArrayRef (*)();
using Register = void (*)(Device, FrameCallback);
using Control = void (*)(Device, int);
using Stop = void (*)(Device);
using Dimensions = int (*)(Device, int *, int *);

struct Api {
  CreateList createList = nullptr;
  Register registerCallback = nullptr, unregisterCallback = nullptr;
  Control start = nullptr;
  Stop stop = nullptr;
  Dimensions dimensions = nullptr;
};

constexpr int kMaxContacts = 10;
struct Contact { int id; double x, y; };
// Every touching contact of one device, so the renderer can follow the finger
// that started a stroke and ignore a palm or thumb that lands later.
struct Frame {
  int device;
  double width, height;
  int count;
  Contact contacts[kMaxContacts];
};
struct Surface { double width, height; };

// MultitouchSupport may reuse a contact's identifier for the next touch. A
// serial is given to each contact when it starts touching, so the renderer can
// tell a new touch from the finger still drawing, even across devices.
struct Tracked { int identifier, serial; };
struct DeviceState { Surface surface; Tracked touching[kMaxContacts]; int count; };

std::mutex lock;
napi_threadsafe_function listener = nullptr;
CFArrayRef devices = nullptr;
DeviceState states[8];
int nextSerial = 0;

const Api *api() {
  static Api loaded;
  static bool ready = [] {
    void *framework = dlopen("/System/Library/PrivateFrameworks/MultitouchSupport.framework/MultitouchSupport", RTLD_NOW | RTLD_LOCAL);
    if (!framework) return false;
    loaded.createList = reinterpret_cast<CreateList>(dlsym(framework, "MTDeviceCreateList"));
    loaded.registerCallback = reinterpret_cast<Register>(dlsym(framework, "MTRegisterContactFrameCallback"));
    loaded.unregisterCallback = reinterpret_cast<Register>(dlsym(framework, "MTUnregisterContactFrameCallback"));
    loaded.start = reinterpret_cast<Control>(dlsym(framework, "MTDeviceStart"));
    loaded.stop = reinterpret_cast<Stop>(dlsym(framework, "MTDeviceStop"));
    loaded.dimensions = reinterpret_cast<Dimensions>(dlsym(framework, "MTDeviceGetSensorSurfaceDimensions"));
    return loaded.createList && loaded.registerCallback && loaded.unregisterCallback && loaded.start && loaded.stop;
  }();
  return ready ? &loaded : nullptr;
}

// MakeTouch (4) and Touching (5); hovering and lifting fingers do not draw.
bool touching(const Touch &touch) { return touch.state == 4 || touch.state == 5; }

int onFrame(Device device, Touch *touches, int count, double, int) {
  std::lock_guard<std::mutex> guard(lock);
  if (!listener || !devices) return 0;
  int index = -1;
  for (CFIndex i = 0; i < CFArrayGetCount(devices) && i < 8; i++)
    if (CFArrayGetValueAtIndex(devices, i) == device) index = static_cast<int>(i);
  if (index < 0) return 0;
  DeviceState &state = states[index];
  auto *frame = new Frame{index, state.surface.width, state.surface.height, 0, {}};
  Tracked current[kMaxContacts];
  for (int i = 0; i < count && frame->count < kMaxContacts; i++) {
    if (!touching(touches[i])) continue;
    int serial = -1;
    for (int j = 0; j < state.count; j++)
      if (state.touching[j].identifier == touches[i].identifier) serial = state.touching[j].serial;
    if (serial < 0) serial = ++nextSerial;
    current[frame->count] = {touches[i].identifier, serial};
    frame->contacts[frame->count++] = {serial, touches[i].normalized.position.x, touches[i].normalized.position.y};
  }
  // One empty frame tells the renderer the last finger lifted; then silence.
  bool silent = frame->count == 0 && state.count == 0;
  state.count = frame->count;
  for (int i = 0; i < frame->count; i++) state.touching[i] = current[i];
  if (silent) {
    delete frame;
    return 0;
  }
  if (napi_call_threadsafe_function(listener, frame, napi_tsfn_nonblocking) != napi_ok) delete frame;
  return 0;
}

void setNumber(napi_env env, napi_value object, const char *name, double value) {
  napi_value number;
  napi_create_double(env, value, &number);
  napi_set_named_property(env, object, name, number);
}

void deliver(napi_env env, napi_value callback, void *, void *data) {
  auto *frame = static_cast<Frame *>(data);
  if (env && callback) {
    napi_value result, contacts, global;
    napi_create_object(env, &result);
    setNumber(env, result, "device", frame->device);
    setNumber(env, result, "width", frame->width);
    setNumber(env, result, "height", frame->height);
    napi_create_array_with_length(env, frame->count, &contacts);
    for (int i = 0; i < frame->count; i++) {
      napi_value contact;
      napi_create_object(env, &contact);
      setNumber(env, contact, "id", frame->contacts[i].id);
      setNumber(env, contact, "x", frame->contacts[i].x);
      setNumber(env, contact, "y", frame->contacts[i].y);
      napi_set_element(env, contacts, i, contact);
    }
    napi_set_named_property(env, result, "contacts", contacts);
    napi_get_global(env, &global);
    napi_call_function(env, global, callback, 1, &result, nullptr);
  }
  delete frame;
}

void stopDevices() {
  const Api *mt = api();
  std::lock_guard<std::mutex> guard(lock);
  if (devices && mt) {
    for (CFIndex i = 0; i < CFArrayGetCount(devices); i++) {
      Device device = const_cast<void *>(CFArrayGetValueAtIndex(devices, i));
      mt->unregisterCallback(device, onFrame);
      mt->stop(device);
    }
    CFRelease(devices);
  }
  devices = nullptr;
  if (listener) napi_release_threadsafe_function(listener, napi_tsfn_abort);
  listener = nullptr;
  for (DeviceState &state : states) state.count = 0;
}

napi_value nothing(napi_env env) {
  napi_value result;
  napi_get_null(env, &result);
  return result;
}

// start(onFrame({ device, width, height, contacts: [{ id, x, y }] })) ->
// { width, height } of the first surface in millimetres, or null when this Mac
// exposes no multitouch surface. x and y are 0..1 with y upwards.
napi_value start(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value callback;
  napi_valuetype type;
  napi_get_cb_info(env, info, &argc, &callback, nullptr, nullptr);
  if (argc != 1 || napi_typeof(env, callback, &type) != napi_ok || type != napi_function) {
    napi_throw_type_error(env, nullptr, "Expected a frame listener.");
    return nullptr;
  }
  stopDevices();
  const Api *mt = api();
  if (!mt) return nothing(env);
  CFArrayRef list = mt->createList();
  if (!list || CFArrayGetCount(list) == 0) {
    if (list) CFRelease(list);
    return nothing(env);
  }
  napi_value name;
  napi_create_string_utf8(env, "nodus-trackpad", NAPI_AUTO_LENGTH, &name);
  napi_threadsafe_function created;
  if (napi_create_threadsafe_function(env, callback, nullptr, name, 256, 1, nullptr, nullptr, nullptr, deliver, &created) != napi_ok) {
    CFRelease(list);
    napi_throw_error(env, nullptr, "TRACKPAD_LISTENER");
    return nullptr;
  }
  // Drawing must never keep the app alive on quit.
  napi_unref_threadsafe_function(env, created);
  {
    std::lock_guard<std::mutex> guard(lock);
    listener = created;
    devices = list;
    for (CFIndex i = 0; i < CFArrayGetCount(list) && i < 8; i++) {
      Device device = const_cast<void *>(CFArrayGetValueAtIndex(list, i));
      int width = 0, height = 0;
      if (mt->dimensions) mt->dimensions(device, &width, &height);
      // Hundredths of a millimetre; a Mac trackpad is about 16:10 when unknown.
      states[i].surface = width > 0 && height > 0 ? Surface{width / 100.0, height / 100.0} : Surface{160, 100};
      mt->registerCallback(device, onFrame);
      mt->start(device, 0);
    }
  }
  napi_value result;
  napi_create_object(env, &result);
  setNumber(env, result, "width", states[0].surface.width);
  setNumber(env, result, "height", states[0].surface.height);
  return result;
}

napi_value stop(napi_env env, napi_callback_info) {
  stopDevices();
  return nothing(env);
}
}  // namespace

static napi_value initialize(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    {"start", nullptr, start, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"stop", nullptr, stop, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 2, methods);
  return exports;
}

NAPI_MODULE(nodus_trackpad, initialize)
