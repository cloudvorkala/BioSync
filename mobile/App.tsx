import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AnalysisScreen } from './src/views/AnalysisScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <AnalysisScreen />
    </SafeAreaProvider>
  );
}
