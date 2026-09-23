import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import fixture from '../src/dev/analysisFixture.json';
import type { AnalysisRequest, AnalysisResult } from '../src/models/api';
import { BackendClientError } from '../src/services/backendClient';
import { useAnalysisViewModel } from '../src/viewmodels/useAnalysisViewModel';
import { response } from './testData';

let renderer: ReactTestRenderer;
let model: ReturnType<typeof useAnalysisViewModel>;
let analyze: jest.Mock<Promise<AnalysisResult>, [AnalysisRequest]>;

function Harness() {
  model = useAnalysisViewModel(analyze);
  return null;
}

beforeEach(async () => {
  analyze = jest.fn();
  await act(async () => {
    renderer = create(<Harness />);
  });
});

afterEach(async () => {
  await act(async () => {
    renderer.unmount();
  });
});

test('begins idle, enters loading, then exposes the service result', async () => {
  let resolve!: (value: AnalysisResult) => void;
  analyze.mockImplementation(
    () =>
      new Promise(done => {
        resolve = done;
      }),
  );
  expect(model.state).toEqual({ status: 'idle' });
  let pending!: Promise<void>;
  await act(async () => {
    pending = model.runTestAnalysis();
  });
  expect(model.state).toEqual({ status: 'loading' });
  expect(analyze).toHaveBeenCalledWith(fixture);
  await act(async () => {
    resolve(response);
    await pending;
  });
  expect(model.state).toEqual({ status: 'success', result: response });
});

test('exposes API errors and can succeed on a later button press', async () => {
  const error = {
    code: 'NETWORK_ERROR',
    message: 'Cannot reach backend.',
    retryable: true,
  };
  analyze.mockRejectedValueOnce(new BackendClientError(error));
  analyze.mockResolvedValueOnce(response);
  await act(async () => {
    await model.runTestAnalysis();
  });
  expect(model.state).toEqual({ status: 'error', error });
  await act(async () => {
    await model.runTestAnalysis();
  });
  expect(model.state).toEqual({ status: 'success', result: response });
});

test('handles unexpected errors without exposing internal details', async () => {
  analyze.mockRejectedValue(new Error('Internal implementation details'));
  await act(async () => {
    await model.runTestAnalysis();
  });
  expect(model.state).toEqual({
    status: 'error',
    error: {
      code: 'CLIENT_ERROR',
      message: 'Analysis could not be completed. Please try again.',
      retryable: false,
    },
  });
});

test('ignores repeated presses while a request is pending', async () => {
  let resolve!: (value: AnalysisResult) => void;
  analyze.mockImplementation(
    () =>
      new Promise(done => {
        resolve = done;
      }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = model.runTestAnalysis();
    await model.runTestAnalysis();
  });
  expect(analyze).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolve(response);
    await pending;
  });
});

test('does not start requests after unmount', async () => {
  await act(async () => {
    renderer.unmount();
  });
  await model.runTestAnalysis();
  expect(analyze).not.toHaveBeenCalled();
});
