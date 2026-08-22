import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppBar, Btn, Card } from '../ui';
import { T } from '../theme';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Connect'>;

export default function ConnectScreen({ navigation }: Props) {
  return (
    <View style={s.root}>
      <AppBar />
      <View style={s.body}>
        <Card style={s.card}>
          <View style={s.glyphWrap}>
            <Text style={s.glyph}>▣</Text>
          </View>

          <Text style={s.title}>Ready to scan documents</Text>
          <Text style={s.sub}>
            Ask the office team to open the scanner on the web application and show you the QR
            code, then connect below.
          </Text>

          <Btn
            label="Scan QR to Connect"
            onPress={() => navigation.navigate('QRScanner')}
            style={{ marginTop: 22, alignSelf: 'stretch' }}
          />
        </Card>

        <Text style={s.foot}>The connection lasts 15 minutes.</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.page },
  body: { flex: 1, justifyContent: 'center', padding: 20 },
  card: { alignItems: 'center', paddingVertical: 30 },
  glyphWrap: {
    width: 92,
    height: 92,
    borderRadius: T.radius,
    backgroundColor: '#e7effb',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  glyph: { fontSize: 46, color: T.blueDark },
  title: { fontSize: 19, fontWeight: '700', color: T.text, marginBottom: 8 },
  sub: { fontSize: 13.5, color: T.muted, textAlign: 'center', lineHeight: 20, paddingHorizontal: 6 },
  foot: { textAlign: 'center', color: T.muted, fontSize: 12, marginTop: 16 },
});
