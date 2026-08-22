import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppBar, Btn, ErrorNote } from '../ui';
import { T } from '../theme';
import { checkHealth, parseQr } from '../api';
import { useSession } from '../store';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'QRScanner'>;
type Phase = 'scanning' | 'verifying' | 'failed';

export default function QRScannerScreen({ navigation }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('scanning');
  const [error, setError] = useState<string | null>(null);
  const connect = useSession((s) => s.connect);

  /* The camera fires this many times a second while the code is in frame. */
  const locked = useRef(false);

  async function onScan(raw: string) {
    if (locked.current) return;
    locked.current = true;
    setPhase('verifying');
    setError(null);

    try {
      const qr = parseQr(raw);
      await checkHealth(qr.serverUrl, qr.sessionToken);
      connect(qr.serverUrl, qr.sessionToken, qr.sessionId);
      navigation.replace('Camera');
    } catch (err: any) {
      setError(err?.message ?? 'Could not connect.');
      setPhase('failed');
    }
  }

  function retry() {
    locked.current = false;
    setError(null);
    setPhase('scanning');
  }

  if (!permission) return <View style={s.root} />;

  if (!permission.granted) {
    return (
      <View style={s.root}>
        <AppBar title="Connect" onBack={() => navigation.goBack()} />
        <View style={s.pad}>
          <Text style={s.permTitle}>Camera access needed</Text>
          <Text style={s.permBody}>
            The scanner uses the camera to read the QR code and photograph documents.
          </Text>
          <Btn label="Allow camera" onPress={requestPermission} style={{ marginTop: 20 }} />
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <AppBar title="Scan QR to Connect" onBack={() => navigation.goBack()} />

      <View style={s.cameraWrap}>
        {phase === 'scanning' && (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => onScan(data)}
          />
        )}

        <View style={s.overlay} pointerEvents="none">
          <View style={s.frame} />
          <Text style={s.hint}>
            {phase === 'verifying'
              ? 'Connecting…'
              : phase === 'failed'
                ? 'Could not connect'
                : 'Point the camera at the QR code on the web application'}
          </Text>
        </View>
      </View>

      <View style={s.pad}>
        <ErrorNote message={error} />
        {phase === 'failed' && (
          <Btn label="Try again" onPress={retry} style={{ marginTop: 12 }} />
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.page },
  cameraWrap: { flex: 1, backgroundColor: '#0d1724' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    width: 236,
    height: 236,
    borderWidth: 3,
    borderColor: T.gold,
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  hint: {
    color: '#fff',
    fontSize: 13.5,
    textAlign: 'center',
    marginTop: 22,
    paddingHorizontal: 34,
    lineHeight: 19,
  },
  pad: { padding: 20 },
  permTitle: { fontSize: 17, fontWeight: '700', color: T.text, marginBottom: 6 },
  permBody: { fontSize: 13.5, color: T.muted, lineHeight: 20 },
});
