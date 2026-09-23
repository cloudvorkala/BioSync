import fixture from '../src/dev/analysisFixture.json';
import type { AnalysisResult } from '../src/models/api';

/** A transport test double, not the fixture's expected numerical answer. */
export const response: AnalysisResult = {
  meal_id: fixture.meal_id,
  computed_at: '2026-09-23T14:05:00.123456Z',
  iauc_mmol_l_min: 42.75,
  feedback: {
    summary: 'A deterministic test response.',
    suggestions: ['An example suggestion from the server.'],
    limitations: ['Development mock only.'],
  },
};
