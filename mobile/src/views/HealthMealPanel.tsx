import React from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useHealthMealViewModel } from '../viewmodels/useHealthMealViewModel';

export function HealthMealPanel() {
  const vm = useHealthMealViewModel();
  const { state, busy } = vm;
  function chooseMealTime(mode: 'date' | 'time') {
    DateTimePickerAndroid.open({
      value: vm.selectedMealTime,
      mode,
      // Native picker uses the phone's timezone, including the selected date's DST.
      // It preserves the other component (clock time or calendar date).
      onValueChange: (_event, date) => vm.updateMealTime(date),
    });
  }
  return (
    <View style={styles.panel}>
      <Text style={styles.text}>Manual meal + {vm.sourceLabel} analysis</Text>
      <Text style={styles.text}>Glucose source: {vm.sourceLabel}</Text>
      <Button
        title="Health Connect"
        disabled={busy}
        onPress={() => vm.updateSource('health_connect')}
      />
      <Button
        title="Samsung Health"
        disabled={busy}
        onPress={() => vm.updateSource('samsung_health')}
      />
      <Text style={styles.text}>
        This action sends the entered meal and selected blood glucose records to
        the configured BioSync backend for iAUC and dietary feedback. In real AI
        mode, the backend sends food descriptions, any entered weight and
        derived analysis to OpenAI, without glucose records or source record
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
      <Text style={styles.text}>Meal time (local)</Text>
      <View style={styles.timeInputs}>
        <Button
          accessibilityLabel="Choose meal date"
          title={vm.selectedMealTime.toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
          disabled={busy}
          onPress={() => chooseMealTime('date')}
        />
        <Button
          accessibilityLabel="Choose meal time"
          title={vm.selectedMealTime.toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
          })}
          disabled={busy}
          onPress={() => chooseMealTime('time')}
        />
      </View>
      <Button
        title="Use current time"
        disabled={busy}
        onPress={vm.useCurrentTime}
      />
      <Text style={styles.text}>
        For completed data, enter a past meal time. This form does not record
        other meals.
      </Text>
      <Text style={styles.text}>
        {vm.sourceLabel}: {state.access.availability}; permission:{' '}
        {state.access.permission} (checked on each action)
      </Text>
      <Button
        title="Request Meal Health Permission"
        disabled={busy}
        onPress={vm.requestHealthPermission}
      />
      <Button
        title={`Analyse ${vm.sourceLabel} Meal`}
        disabled={busy}
        onPress={vm.analyseMeal}
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
            {`${vm.sourceLabel} returned no records in this range. The backend determines whether analysis is possible.`}
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
  timeInputs: { flexDirection: 'row', gap: 8 },
  text: { color: '#172b3a', fontSize: 16 },
  input: {
    borderWidth: 1,
    borderColor: '#666666',
    padding: 8,
    color: '#172b3a',
  },
});
