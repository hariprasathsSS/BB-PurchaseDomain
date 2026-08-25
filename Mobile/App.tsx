import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import ConnectScreen from './src/screens/ConnectScreen';
import QRScannerScreen from './src/screens/QRScannerScreen';
import CameraScreen from './src/screens/CameraScreen';
import PreviewScreen from './src/screens/PreviewScreen';
import QueueScreen from './src/screens/QueueScreen';
import { T } from './src/theme';
import type { DocType } from './src/theme';

export type RootStackParamList = {
  Connect: undefined;
  QRScanner: undefined;
  Camera: undefined;
  /* intent is what Camera's own type pills were set to when the shutter was
     pressed — Preview starts on that choice instead of always defaulting to
     Invoice, but it's still just a starting point: fully changeable here. */
  Preview: { uri: string; intent?: DocType };
  Queue: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <SafeAreaProvider>
      {/* Every screen draws its own navy AppBar, so the status bar is light. */}
      <StatusBar style="light" />
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Connect"
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: T.page },
          }}
        >
          <Stack.Screen name="Connect" component={ConnectScreen} />
          <Stack.Screen name="QRScanner" component={QRScannerScreen} />
          <Stack.Screen name="Camera" component={CameraScreen} />
          <Stack.Screen name="Preview" component={PreviewScreen} />
          <Stack.Screen name="Queue" component={QueueScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
