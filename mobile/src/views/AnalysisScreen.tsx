import React from 'react';
import {
  ActivityIndicator,
  Button,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAnalysisViewModel } from '../viewmodels/useAnalysisViewModel';
import { HealthConnectPanel } from './HealthConnectPanel';
import { HealthMealPanel } from './HealthMealPanel';

export function AnalysisScreen() {
  const { state, runTestAnalysis } = useAnalysisViewModel();
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>BioSync</Text>
        <Text style={styles.text}>
          Development test data · backend dietary feedback
        </Text>
        <Text style={styles.text}>
          This analysis request uses a fixed fixture, not Health Connect data.
        </Text>
        <Text style={styles.heading} accessibilityLiveRegion="polite">
          Request state: {state.status}
        </Text>
        <Button
          title="Run Test Analysis"
          disabled={state.status === 'loading'}
          onPress={runTestAnalysis}
        />
        {state.status === 'loading' && (
          <ActivityIndicator accessibilityLabel="Analyzing meal" />
        )}
        {state.status === 'error' && (
          <View accessibilityLiveRegion="polite">
            <Text style={styles.error}>{state.error.code}</Text>
            <Text style={styles.text}>{state.error.message}</Text>
            <Text style={styles.text}>
              Retryable: {state.error.retryable ? 'yes' : 'no'}
            </Text>
          </View>
        )}
        {state.status === 'success' && (
          <View accessibilityLiveRegion="polite">
            <Text style={styles.heading}>
              iAUC: {state.result.iauc_mmol_l_min} (mmol/L)·min
            </Text>
            <Text style={styles.heading}>Feedback</Text>
            <Text style={styles.text}>{state.result.feedback.summary}</Text>
            <Text style={styles.heading}>Dietary suggestions</Text>
            {state.result.feedback.suggestions.length === 0 && (
              <Text style={styles.text}>
                No suggestions returned by the backend.
              </Text>
            )}
            {state.result.feedback.suggestions.map((suggestion, index) => (
              <Text key={index} style={styles.text}>
                • {suggestion}
              </Text>
            ))}
            <Text style={styles.heading}>Limitations</Text>
            {state.result.feedback.limitations.map((limitation, index) => (
              <Text key={index} style={styles.text}>
                • {limitation}
              </Text>
            ))}
          </View>
        )}
        <HealthMealPanel />
        <HealthConnectPanel />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#ffffff' },
  content: { padding: 24, gap: 16 },
  title: { fontSize: 30, fontWeight: '700', color: '#172b3a' },
  heading: {
    fontSize: 18,
    fontWeight: '600',
    marginVertical: 12,
    color: '#172b3a',
  },
  text: { fontSize: 16, lineHeight: 24, color: '#172b3a' },
  error: {
    fontSize: 18,
    fontWeight: '600',
    marginVertical: 12,
    color: '#b00020',
  },
});
