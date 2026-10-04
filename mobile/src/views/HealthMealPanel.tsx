import React from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { useHealthMealViewModel } from '../viewmodels/useHealthMealViewModel';

export function HealthMealPanel() {
  const vm = useHealthMealViewModel();
  const { state, busy } = vm;
  return (
    <View style={styles.panel}>
      <Text style={styles.text}>Manual meal + Health Connect analysis</Text>
      <Text style={styles.text}>
        This action sends the entered meal and selected blood glucose records to
        the configured BioSync backend for iAUC and dietary feedback. In real AI
        mode, the backend sends food descriptions, any entered weight and
        derived analysis to OpenAI, without glucose records or Health Connect
        IDs.
      </Text>
      <Text style={styles.text}>Meal description (manual input)</Text>
      <TextInput
        accessibilityLabel="Meal description"
        style={styles.input}
        placeholder="Chicken rice with broccoli"
        placeholderTextColor="#555555"
        value={vm.description}
        editable={!busy}
        onChangeText={vm.updateDescription}
      />
      <Text style={styles.text}>Approximate weight (g, optional)</Text>
      <TextInput
        accessibilityLabel="Approximate weight (g)"
        style={styles.input}
        placeholder="350"
        placeholderTextColor="#555555"
        keyboardType="decimal-pad"
        value={vm.weight}
        editable={!busy}
        onChangeText={vm.updateWeight}
      />
      <Text style={styles.text}>Meal time (UTC ISO 8601, ending in Z)</Text>
      <TextInput
        accessibilityLabel="Meal time UTC"
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        value={vm.mealTime}
        editable={!busy}
        onChangeText={vm.updateMealTime}
      />
      <Text style={styles.text}>
        For completed data, enter a past meal time. This form does not record
        other meals.
      </Text>
      <Text style={styles.text}>
        Health Connect: {state.access.availability}; permission:{' '}
        {state.access.permission} (checked on each action)
      </Text>
      <Button
        title="Request Meal Health Permission"
        disabled={busy}
        onPress={vm.requestHealthPermission}
      />
      <Button
        title="Analyse Health Connect Meal"
        disabled={busy}
        onPress={vm.analyseHealthConnectMeal}
      />
      <View accessibilityLiveRegion="polite">
        <Text style={styles.text}>Meal analysis state: {state.phase}</Text>
        {state.query && (
          <Text style={styles.text}>
            Query UTC: {state.query.start} → {state.query.end} (end exclusive)
          </Text>
        )}
        <Text style={styles.text}>
          Glucose records selected: {state.readingCount ?? 'not loaded'}
        </Text>
        {state.readingCount === 0 && (
          <Text style={styles.text}>
            Health Connect returned no records in this range. The backend
            determines whether analysis is possible.
          </Text>
        )}
        {state.error && (
          <Text style={styles.text}>
            {state.error.kind}: {state.error.code}
            {'\n'}
            {state.error.message}
          </Text>
        )}
        {state.result && (
          <View>
            <Text style={styles.text}>
              Meal iAUC: {state.result.iauc_mmol_l_min} (mmol/L)·min
            </Text>
            <Text style={styles.text}>{state.result.feedback.summary}</Text>
            <Text style={styles.text}>Dietary suggestions</Text>
            {state.result.feedback.suggestions.length === 0 && (
              <Text style={styles.text}>
                No suggestions returned by the backend.
              </Text>
            )}
            {state.result.feedback.suggestions.map((item, index) => (
              <Text style={styles.text} key={index}>
                • {item}
              </Text>
            ))}
            {state.result.feedback.limitations.map((item, index) => (
              <Text style={styles.text} key={index}>
                • {item}
              </Text>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  panel: { gap: 8 },
  text: { color: '#172b3a', fontSize: 16 },
  input: {
    borderWidth: 1,
    borderColor: '#666666',
    padding: 8,
    color: '#172b3a',
  },
});
