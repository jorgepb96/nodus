import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

test("Dictionary jobs run in parallel and remain isolated", async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), "nodus-dictionary-queue-"));
  try {
    const bundle = path.join(output, "queue.mjs");
    await build({
      entryPoints: [
        path.join(root, "electron/ai/dictionaryGenerationQueue.ts"),
      ],
      outfile: bundle,
      bundle: true,
      format: "esm",
      platform: "node",
      logLevel: "silent",
    });
    const { DictionaryGenerationQueue } = await import(pathToFileURL(bundle));

    const gates = new Map();
    const invocations = new Map();
    const events = [];
    let active = 0;
    let peak = 0;
    const queue = new DictionaryGenerationQueue(
      async (request, report) => {
        invocations.set(
          request.entryId,
          (invocations.get(request.entryId) ?? 0) + 1,
        );
        active += 1;
        peak = Math.max(peak, active);
        report({
          entryId: request.entryId,
          phase: "generating",
          message: "Generando definición",
        });
        const gate = deferred();
        gates.set(request.entryId, gate);
        await gate.promise;
        active -= 1;
        if (request.entryId === "bad") throw new Error("provider down");
      },
      (progress) => events.push(progress),
    );

    const request = (entryId) => ({ entryId, mode: "creation", model: null });
    queue.start(request("slow"));
    queue.start(request("bad"));
    queue.start(request("fast"));
    const duplicate = queue.start(request("slow"));
    assert.equal(duplicate.phase, "queued");

    await waitFor(() => gates.size === 3, "all three concurrent jobs");
    assert.equal(peak, 3, "all entries reach the provider before any completes");
    assert.equal(invocations.get("slow"), 1, "an active entry is not started twice");

    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      gates.get("fast").resolve();
      gates.get("bad").resolve();
      await waitFor(
        () =>
          queue.list().find((job) => job.entryId === "fast")?.phase ===
            "done" &&
          queue.list().find((job) => job.entryId === "bad")?.phase ===
            "failed",
        "independent success and failure",
      );
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(
      queue.list().find((job) => job.entryId === "slow")?.phase,
      "generating",
      "out-of-order completions do not change another entry",
    );

    queue.delete(["slow"]);
    gates.get("slow").resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(
      !queue.list().some((job) => job.entryId === "slow"),
      "a deleted entry cannot reappear through stale completion",
    );

    console.error = () => undefined;
    try {
      queue.start(request("bad"));
      await waitFor(() => invocations.get("bad") === 2, "failed job retry");
      gates.get("bad").resolve();
      await waitFor(
        () => queue.list().find((job) => job.entryId === "bad")?.phase === "failed",
        "retried failure",
      );
    } finally {
      console.error = originalConsoleError;
    }

    assert.ok(
      events.some((event) => event.entryId === "fast" && event.phase === "done"),
    );
    assert.ok(
      events.some(
        (event) =>
          event.entryId === "bad" &&
          event.phase === "failed" &&
          event.error === "provider down",
      ),
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("Dictionary retries transient provider failures without exposing a terminal error", async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), "nodus-dictionary-retry-"));
  try {
    const bundle = path.join(output, "queue.mjs");
    await build({
      entryPoints: [path.join(root, "electron/ai/dictionaryGenerationQueue.ts")],
      outfile: bundle,
      bundle: true,
      format: "esm",
      platform: "node",
      logLevel: "silent",
    });
    const { DictionaryGenerationQueue } = await import(pathToFileURL(bundle));
    const events = [];
    let attempts = 0;
    const queue = new DictionaryGenerationQueue(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          const error = new Error("rate limited");
          error.retriable = true;
          throw error;
        }
      },
      (progress) => events.push(progress),
    );
    queue.start({ entryId: "retry", mode: "regeneration", model: null });
    await waitFor(
      () => queue.list().find((job) => job.entryId === "retry")?.phase === "done",
      "transient retry completion",
    );
    assert.equal(attempts, 3);
    assert.equal(events.some((event) => event.phase === "failed"), false);
    assert.ok(events.filter((event) => event.phase === "queued").length >= 3);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("Dictionary reports degraded attempts without presenting them as generated", async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), "nodus-dictionary-degraded-"));
  try {
    const bundle = path.join(output, "queue.mjs");
    await build({
      entryPoints: [path.join(root, "electron/ai/dictionaryGenerationQueue.ts")],
      outfile: bundle,
      bundle: true,
      format: "esm",
      platform: "node",
      logLevel: "silent",
    });
    const { DictionaryGenerationQueue } = await import(pathToFileURL(bundle));
    const events = [];
    const queue = new DictionaryGenerationQueue(
      async () => ({
        outcome: "degraded",
        degradationReason: "semantic_rejection",
        generationAttempts: 3,
        generationProblems: ["no valid claims survived"],
      }),
      (progress) => events.push(progress),
    );
    queue.start({ entryId: "degraded", mode: "creation", model: null });
    await waitFor(
      () => queue.list().find((job) => job.entryId === "degraded")?.phase === "degraded",
      "degraded terminal state",
    );
    const terminal = queue.list().find((job) => job.entryId === "degraded");
    assert.equal(terminal.phase, "degraded");
    assert.equal(terminal.attempts, 3);
    assert.equal(terminal.degradationReason, "semantic_rejection");
    assert.equal(events.some((event) => event.phase === "done"), false);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('Dictionary continuation preserves run identity, pause state and current worker ownership', async()=>{
 const output=await mkdtemp(path.join(os.tmpdir(),'nodus-dictionary-resume-'));
 try{
  const bundle=path.join(output,'queue.mjs');await build({entryPoints:[path.join(root,'electron/ai/dictionaryGenerationQueue.ts')],outfile:bundle,bundle:true,format:'esm',platform:'node',logLevel:'silent'});
  const {DictionaryGenerationQueue}=await import(pathToFileURL(bundle));
  const events=[],requests=[];let attempt=0;
  const base={id:'run-1',entryId:'entry',version:'v1',mode:'dictionary',objective:'Memory',status:'running',questions:[],tasks:[],usage:{rounds:1,evidenceBytes:100,decisionBytes:200},updatedAt:'2026-10-18'};
  const queue=new DictionaryGenerationQueue(async(request,report)=>{
   requests.push(request);if(++attempt===1){report({entryId:'entry',phase:'generating',message:'Generating',researchRun:{...base,status:'failed'}});throw Object.assign(new Error('transient'),{retriable:true});}
   return {id:'version',outcome:'synthesis',researchRun:{...base,status:'completed'}};
  },p=>events.push(p));
  await queue.run({entryId:'entry',mode:'creation'});assert.equal(requests[1].runId,'run-1','Transient retry continues the pinned run and its consumed allowance');assert.equal(queue.list()[0].phase,'done');assert.equal(queue.list()[0].researchRun.status,'completed');assert.ok(!events.some(p=>p.phase==='failed'));
  const pauseEvents=[];let paused=true;
  const pausedQueue=new DictionaryGenerationQueue(async(_request,report)=>{if(paused){report({entryId:'entry',phase:'generating',message:'Generating',researchRun:{...base,status:'paused'}});throw Error('research_run_paused');}return {id:'version',outcome:'synthesis',researchRun:{...base,status:'completed'}};},p=>pauseEvents.push(p));
  await assert.rejects(()=>pausedQueue.run({entryId:'entry',mode:'creation'}),/paused/);assert.equal(pausedQueue.list()[0].phase,'paused');assert.equal(pausedQueue.list()[0].error,undefined,'User pause is not displayed as a generation failure');paused=false;await pausedQueue.run({entryId:'entry',mode:'creation',runId:'run-1'});assert.equal(pausedQueue.list()[0].phase,'done');
  const late=deferred();let workers=0;const ownership=new DictionaryGenerationQueue(async(_request,report)=>{if(++workers===1){report({entryId:'entry',phase:'generating',message:'Generating',researchRun:base});await late.promise;throw Error('old stopped worker');}return {id:'version',outcome:'synthesis',researchRun:{...base,status:'completed'}};},()=>{});
  ownership.start({entryId:'entry',mode:'creation'});await waitFor(()=>workers===1,'first worker');await assert.rejects(()=>ownership.run({entryId:'entry',mode:'creation',runId:'another-run'}),/already_running/);await ownership.run({entryId:'entry',mode:'creation',runId:'run-1'});late.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(ownership.list()[0].phase,'done','The previous worker cannot overwrite a resumed completion');
 }finally{await rm(output,{recursive:true,force:true});}
});
