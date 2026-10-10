import { BACKEND_BASE_URL } from '../config/development';
import type { AnalysisRequest, AnalysisResult, ApiError } from '../models/api';

export class BackendClientError extends Error {
  constructor(
    public readonly apiError: ApiError,
    public readonly status?: number,
  ) {
    super(apiError.message);
    this.name = 'BackendClientError';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isApiError(value: unknown): value is ApiError {
  return (
    isObject(value) &&
    typeof value.code === 'string' &&
    typeof value.message === 'string' &&
    typeof value.retryable === 'boolean'
  );
}

function isAnalysisResult(value: unknown): value is AnalysisResult {
  if (!isObject(value) || !isObject(value.feedback)) {
    return false;
  }
  return (
    typeof value.meal_id === 'string' &&
    typeof value.computed_at === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(
      value.computed_at,
    ) &&
    Number.isFinite(Date.parse(value.computed_at)) &&
    typeof value.iauc_mmol_l_min === 'number' &&
    Number.isFinite(value.iauc_mmol_l_min) &&
    value.iauc_mmol_l_min >= 0 &&
    typeof value.feedback.summary === 'string' &&
    isStringArray(value.feedback.suggestions) &&
    isStringArray(value.feedback.limitations)
  );
}

function invalidResponse(status: number): BackendClientError {
  return new BackendClientError(
    {
      code: 'INVALID_RESPONSE',
      message: 'The backend returned an unexpected response.',
      retryable: false,
    },
    status,
  );
}

/** No calculation or provider logic. Local failures use client-only error codes. */
export async function analyzeMeal(
  request: AnalysisRequest,
  baseUrl = BACKEND_BASE_URL,
): Promise<AnalysisResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/analyses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      if (controller.signal.aborted) {
        throw new Error('Request timed out');
      }
      throw invalidResponse(response.status);
    }
    if (!response.ok) {
      if (isObject(body) && isApiError(body.error)) {
        throw new BackendClientError(body.error, response.status);
      }
      throw invalidResponse(response.status);
    }
    if (
      response.status !== 200 ||
      !isAnalysisResult(body) ||
      body.meal_id !== request.meal_id
    ) {
      throw invalidResponse(response.status);
    }
    return body;
  } catch (error) {
    if (error instanceof BackendClientError) {
      throw error;
    }
    throw new BackendClientError({
      code: controller.signal.aborted ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
      message: controller.signal.aborted
        ? 'The request timed out. Check the backend and try again.'
        : 'Cannot reach the backend. Check its address and your connection.',
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
  }
}
