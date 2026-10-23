"""Reproduce the pinned Harrier Q8 WASM compatibility graph (requires onnx).
Only expands GatherBlockQuantized into standard ONNX operators; keeps the
upstream uint8 weights and dequantizes the requested token rows, not the table.
"""
import pathlib, urllib.request, hashlib
import onnx
from onnx import helper, TensorProto
root = pathlib.Path(__file__).resolve().parents[1]
revision = 'd59c919d0159aea2c19ed7d04288fcdd048d0f9c'
url = f'https://huggingface.co/onnx-community/harrier-oss-v1-270m-ONNX/resolve/{revision}/onnx/model_quantized.onnx'
model = onnx.load_model_from_string(urllib.request.urlopen(url).read())
nodes = []
replaced = 0
for n in model.graph.node:
    if n.op_type != 'GatherBlockQuantized':
        nodes.append(n)
        continue
    assert {a.name: a.i for a in n.attribute} == dict(bits=8, block_size=32, gather_axis=0, quantize_axis=1)
    replaced += 1
    q, ids, scale, zero = n.input
    def node(op, inputs, output, **kw):
        nodes.append(helper.make_node(op, inputs, [output], name=output, **kw))
    for data, out in [(q, 'nd_q'), (scale, 'nd_s'), (zero, 'nd_z')]:
        node('Gather', [data, ids], out, axis=0)
    node('Cast', ['nd_q'], 'nd_qf', to=TensorProto.FLOAT)
    node('Cast', ['nd_z'], 'nd_zf', to=TensorProto.FLOAT)
    for name, value in [('nd_block_shape', [0, 0, 20, 32]), ('nd_output_shape', [0, 0, 640]), ('nd_last_axis', [-1])]:
        model.graph.initializer.append(helper.make_tensor(name, TensorProto.INT64, [len(value)], value))
    node('Reshape', ['nd_qf', 'nd_block_shape'], 'nd_blocks')
    node('Unsqueeze', ['nd_s', 'nd_last_axis'], 'nd_scales')
    node('Unsqueeze', ['nd_zf', 'nd_last_axis'], 'nd_zeros')
    node('Sub', ['nd_blocks', 'nd_zeros'], 'nd_centered')
    node('Mul', ['nd_centered', 'nd_scales'], 'nd_dequant')
    node('Reshape', ['nd_dequant', 'nd_output_shape'], n.output[0])
assert replaced == 1
model.graph.ClearField('node')
model.graph.node.extend(nodes)
output = root / 'zotero-plugin/content/models/harrier-270m-q8-wasm.onnx'
output.write_bytes(model.SerializeToString())
print(hashlib.sha256(output.read_bytes()).hexdigest(), output)
