import fixture from '../src/dev/analysisFixture.json';
import { BACKEND_BASE_URL } from '../src/config/development';
import { analyzeMeal, BackendClientError } from '../src/services/backendClient';
import { response } from './testData';

const originalFetch = globalThis.fetch;
const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();

function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.useRealTimers();
});

test('posts the complete fixture and returns the actual parsed response', async () => {
  respond(response);
  await expect(analyzeMeal(fixture)).resolves.toEqual(response);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(`${BACKEND_BASE_URL}/v1/analyses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(fixture),
    signal: expect.anything(),
  });
});

test('supports an explicitly configured base URL', async () => {
  respond(response);
  await analyzeMeal(fixture, 'https://example.test/');
  expect(fetchMock.mock.calls[0][0]).toBe('https://example.test/v1/analyses');
});

test.each([
  [400, 'INVALID_REQUEST', false],
  [422, 'WAITING_FOR_GLUCOSE_DATA', true],
  [422, 'INSUFFICIENT_BASELINE_DATA', false],
  [500, 'INTERNAL_ERROR', false],
])(
  'preserves the documented error envelope for HTTP %s, %s',
  async (status, code, retryable) => {
    const error = { code, message: 'A backend explanation.', retryable };
    respond({ error }, status);
    await expect(analyzeMeal(fixture)).rejects.toMatchObject({
      name: 'BackendClientError',
      status,
      apiError: error,
    });
  },
);

test('accepts a genuinely zero iAUC response', async () => {
  respond({ ...response, iauc_mmol_l_min: 0 });
  await expect(analyzeMeal(fixture)).resolves.toMatchObject({
    iauc_mmol_l_min: 0,
  });
});

test.each([
  null,
  { error: { code: 'BAD', message: 'not a success', retryable: false } },
  { ...response, iauc_mmol_l_min: '42.75' },
  { ...response, iauc_mmol_l_min: NaN },
  { ...response, iauc_mmol_l_min: Infinity },
  { ...response, iauc_mmol_l_min: -1 },
  { ...response, computed_at: '2026-09-23T14:05:00+12:00' },
  { ...response, computed_at: 'invalid' },
  { ...response, meal_id: 'another-meal' },
  { ...response, feedback: { ...response.feedback, suggestions: [123] } },
])('rejects invalid successful response %#', async body => {
  respond(body);
  await expect(analyzeMeal(fixture)).rejects.toMatchObject({
    apiError: { code: 'INVALID_RESPONSE' },
  });
});

test('does not treat an error HTTP status with a success body as success', async () => {
  respond(response, 500);
  await expect(analyzeMeal(fixture)).rejects.toMatchObject({ status: 500 });
});

test('rejects malformed error envelopes', async () => {
  respond(
    { error: { code: 'ERROR', message: 'failure', retryable: 'true' } },
    422,
  );
  await expect(analyzeMeal(fixture)).rejects.toMatchObject({
    apiError: { code: 'INVALID_RESPONSE' },
  });
});

test('hides non-JSON server responses', async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    status: 502,
    json: async () => {
      throw new Error('An HTML proxy page');
    },
  } as unknown as Response);
  await expect(analyzeMeal(fixture)).rejects.toMatchObject({
    status: 502,
    apiError: {
      code: 'INVALID_RESPONSE',
      message: 'The backend returned an unexpected response.',
    },
  });
});

test('maps network failures to a retryable client error', async () => {
  fetchMock.mockRejectedValue(new TypeError('Sensitive platform details'));
  await expect(analyzeMeal(fixture)).rejects.toMatchObject({
    apiError: { code: 'NETWORK_ERROR', retryable: true },
  });
});

test('aborts a stalled request after 15 seconds', async () => {
  jest.useFakeTimers();
  fetchMock.mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        );
      }),
  );
  const result = analyzeMeal(fixture).catch(error => error);
  await jest.advanceTimersByTimeAsync(15_000);
  expect(await result).toBeInstanceOf(BackendClientError);
  expect(await result).toMatchObject({
    apiError: { code: 'REQUEST_TIMEOUT', retryable: true },
  });
  expect(jest.getTimerCount()).toBe(0);
});
