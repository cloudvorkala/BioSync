/** Transport objects from docs/API_CONTRACTS.md. Timestamps use UTC with Z. */
export interface GlucoseReading {
  source: string;
  source_record_id: string;
  measured_at: string;
  value_mmol_l: number;
}

export interface FoodInfo {
  recognized_at: string;
  items: { name: string; weight_g?: number; confidence?: number }[];
}

export interface Feedback {
  summary: string;
  suggestions: string[];
  limitations: string[];
}

export interface AnalysisResult {
  meal_id: string;
  computed_at: string;
  iauc_mmol_l_min: number;
  feedback: Feedback;
}

export interface AnalysisRequest {
  meal_id: string;
  meal_at: string;
  food_info: FoodInfo;
  readings: GlucoseReading[];
  other_meal_times?: string[];
}

export interface ApiError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ApiErrorEnvelope {
  error: ApiError;
}
