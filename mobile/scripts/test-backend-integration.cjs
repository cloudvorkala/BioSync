/* Real HTTP regression test. Start Flask first. No native/device test is implied. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');

// Execute the actual TypeScript client/helpers in Node, without a Metro server.
require.extensions['.ts'] = (loadedModule, filename) => {
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  loadedModule._compile(compiled, filename);
};
const { analyzeMeal } = require('../src/services/backendClient.ts');
const {
  manualAnalysisRequest,
  manualFoodInfo,
  normalizeMealTime,
} = require('../src/models/manualMeal.ts');
const {
  mapBloodGlucoseRecord,
} = require('../src/services/healthConnectMapping.ts');
const fixture = require('../src/dev/analysisFixture.json');

async function main() {
  const url = process.env.BIOSYNC_TEST_BACKEND_URL || 'http://127.0.0.1:5000';
  const fixtureResult = await analyzeMeal(fixture, url);
  assert.equal(fixtureResult.iauc_mmol_l_min, 225);
  // Explicit synthetic native-shaped inputs, never actual device records.
  const readings = fixture.readings.map(reading =>
    mapBloodGlucoseRecord({
      time: reading.measured_at,
      metadata: { id: reading.source_record_id },
      level: {
        inMillimolesPerLiter: reading.value_mmol_l,
        inMilligramsPerDeciliter: reading.value_mmol_l * 18,
      },
    }),
  );
  const request = manualAnalysisRequest(
    'a89bca1e-7ed1-42d5-9c52-e28cb67c3199',
    normalizeMealTime(fixture.meal_at),
    manualFoodInfo(
      'Chicken rice with broccoli',
      new Date('2026-10-04T00:00:00Z'),
    ),
    readings,
  );
  const result = await analyzeMeal(request, url);
  assert.equal(result.iauc_mmol_l_min, 225);
  assert.match(result.feedback.summary, /Chicken rice with broccoli/);
  assert.match(result.feedback.summary, /Development mock/);
  for (const [records, code] of [
    [[], 'INSUFFICIENT_BASELINE_DATA'],
    [readings.slice(0, -1), 'WAITING_FOR_GLUCOSE_DATA'],
    [
      readings.filter(r => r.source_record_id !== 'dev-post-30'),
      'INSUFFICIENT_GLUCOSE_DATA',
    ],
  ]) {
    await assert.rejects(
      analyzeMeal({ ...request, readings: records }, url),
      error => error.status === 422 && error.apiError.code === code,
    );
  }
  const outputDir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, 'manual-analysis-request.json'),
    JSON.stringify(request, null, 2),
  );
  console.log(
    'PASS: fixture iAUC 225; manual request iAUC 225; three distinct policy errors. Synthetic inputs, real Flask HTTP; no native-device test.',
  );
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
