import React from 'react';
import { Button, Text, TextInput, View } from 'react-native';
import { useSamsungHealthViewModel } from '../viewmodels/useSamsungHealthViewModel';

export function SamsungHealthPanel() {
  const vm = useSamsungHealthViewModel();
  const { state, busy } = vm;
  return (
    <View accessibilityLiveRegion="polite">
      <Text>Samsung Health — blood glucose diagnostic</Text>
      <Text>Data SDK 1.1.0 · physical-device verification pending</Text>
      <Text>
        These diagnostic readings and source packages stay on this device.
      </Text>
      <Text>SDK availability: {state.access.availability}</Text>
      <Text>Samsung permission: {state.access.permission}</Text>
      <Text>Operation: {state.operation}</Text>
      {state.access.availability === 'unavailable' && (
        <Text>
          Use a physical Android 10+ phone with Samsung Health installed and
          enabled.
        </Text>
      )}
      {state.access.availability === 'update_required' && (
        <Text>Update Samsung Health to 6.30.2 or later.</Text>
      )}
      {state.access.availability === 'initialization_required' && (
        <Text>Open Samsung Health and complete setup.</Text>
      )}
      {state.access.availability === 'read_access_unavailable' && (
        <Text>
          SDK read access is blocked. Check development Data Read mode or app
          registration/account restrictions.
        </Text>
      )}
      {state.access.permission === 'denied' && (
        <Text>
          Blood glucose permission is not granted. Request access to continue.
        </Text>
      )}
      <Button
        title="Check Samsung Health Status"
        disabled={busy}
        onPress={vm.checkStatus}
      />
      <Button
        title="Request Samsung Health Permission"
        disabled={busy}
        onPress={vm.requestPermission}
      />
      <Text>Start UTC (inclusive)</Text>
      <TextInput
        accessibilityLabel="Samsung start UTC"
        value={vm.startTime}
        editable={!busy}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={vm.updateStart}
      />
      <Text>End UTC (exclusive)</Text>
      <TextInput
        accessibilityLabel="Samsung end UTC"
        value={vm.endTime}
        editable={!busy}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={vm.updateEnd}
      />
      <Button
        title="Load Samsung Health Blood Glucose"
        disabled={busy}
        onPress={vm.loadReadings}
      />
      {state.period && (
        <Text>
          Loaded UTC range: {state.period.start} → {state.period.end}
        </Text>
      )}
      <Text>
        Samsung records: {state.result?.readings.length ?? 'not loaded'}
      </Text>
      {state.result?.readings.length === 0 && (
        <Text>
          No Samsung blood glucose records in this period. The read succeeded.
        </Text>
      )}
      {state.result?.readings.slice(-5).map(reading => (
        <Text key={reading.source_record_id}>
          {reading.measured_at}: {reading.value_mmol_l} mmol/L{'\n'}
          Source package:{' '}
          {state.result?.sourcePackages[reading.source_record_id] ??
            'not supplied'}
        </Text>
      ))}
      {state.error && <Text accessibilityRole="alert">{state.error}</Text>}
    </View>
  );
}
