import React from 'react';
import { Button, Text, View } from 'react-native';
import { useHealthConnectViewModel } from '../viewmodels/useHealthConnectViewModel';

export function HealthConnectPanel() {
  const { state, busy, requestHealthPermission, loadBloodGlucose } =
    useHealthConnectViewModel();
  return (
    <View accessibilityLiveRegion="polite">
      <Text>Health Connect — blood glucose diagnostic</Text>
      <Text>
        Reads the last 24 hours. Data stays on this device and is not sent for
        analysis.
      </Text>
      <Text>Health Connect status: {state.availability}</Text>
      <Text>Permission status: {state.permission}</Text>
      <Text>Operation: {state.operation}</Text>
      {state.availability === 'unavailable' && (
        <Text>Health Connect is unavailable on this device.</Text>
      )}
      {state.availability === 'update_required' && (
        <Text>Install or update Health Connect, then retry.</Text>
      )}
      {state.permission === 'denied' && (
        <Text>
          Blood glucose access is not granted. Request permission or enable it
          in Health Connect settings.
        </Text>
      )}
      <Button
        title="Request Health Permission"
        disabled={busy}
        onPress={requestHealthPermission}
      />
      <Button
        title="Load Blood Glucose"
        disabled={busy}
        onPress={loadBloodGlucose}
      />
      {state.period && (
        <Text>
          UTC range: {state.period.start} → {state.period.end}
        </Text>
      )}
      <Text>
        Number of records:{' '}
        {state.readings === null ? 'not loaded' : state.readings.length}
      </Text>
      {state.readings?.length === 0 && (
        <Text>
          No blood glucose records in this period. The read succeeded.
        </Text>
      )}
      {state.readings?.slice(-5).map((reading, index) => (
        <Text key={`${reading.source_record_id}-${index}`}>
          {reading.measured_at}: {reading.value_mmol_l} mmol/L{'\n'}ID:{' '}
          {reading.source_record_id}
        </Text>
      ))}
      {state.error && <Text accessibilityRole="alert">{state.error}</Text>}
    </View>
  );
}
