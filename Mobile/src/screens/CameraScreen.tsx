import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppBar, Btn } from '../ui';
import { T } from '../theme';
import { totalPages, useSession } from '../store';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Camera'>;

export default function CameraScreen({ navigation }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const camera = useRef<CameraView>(null);

  const queue = useSession((s) => s.queue);
  const draftPages = useSession((s) => s.draftPages);

  async function capture() {
    if (busy) return;
    setBusy(true);
    try {
      // quality 0.6 keeps a document page around 300-600 KB, which uploads
      // over site Wi-Fi without a separate compression step.
      const shot = await camera.current?.takePictureAsync({ quality: 0.6 });
      if (shot?.uri) navigation.navigate('Preview', { uri: shot.uri });
    } finally {
      setBusy(false);
    }
  }

  if (!permission) return <View style={s.root} />;

  if (!permission.granted) {
    return (
      <View style={s.root}>
        <AppBar title="Scan Document" />
        <View style={{ padding: 20 }}>
          <Text style={s.permTitle}>Camera access needed</Text>
          <Btn label="Allow camera" onPress={requestPermission} style={{ marginTop: 18 }} />
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <AppBar
        title="Scan Document"
        right={
          <Pressable style={s.queueChip} onPress={() => navigation.navigate('Queue')}>
            <Text style={s.queueChipText}>
              {queue.length} doc{queue.length === 1 ? '' : 's'}
            </Text>
          </Pressable>
        }
      />

      <View style={s.cameraWrap}>
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />

        <View style={s.overlay} pointerEvents="none">
          <View style={s.frame} />
        </View>

        {draftPages.length > 0 && (
          <View style={s.draftBadge}>
            <Text style={s.draftBadgeText}>
              Page {draftPages.length + 1} of this document
            </Text>
          </View>
        )}
      </View>

      <View style={s.bar}>
        <View style={s.barSide}>
          <Text style={s.count}>{totalPages(queue)}</Text>
          <Text style={s.countLabel}>pages</Text>
        </View>

        <Pressable
          onPress={capture}
          disabled={busy}
          style={({ pressed }) => [s.shutter, { opacity: busy ? 0.5 : pressed ? 0.75 : 1 }]}
        >
          <View style={s.shutterInner} />
        </Pressable>

        <View style={s.barSide}>
          <Btn
            label="Queue"
            tone="ghost"
            onPress={() => navigation.navigate('Queue')}
            style={{ height: 40, paddingHorizontal: 14 }}
          />
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.navy },
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
    width: '84%',
    height: '74%',
    borderWidth: 2,
    borderColor: 'rgba(233,161,59,0.9)',
    borderRadius: 10,
    borderStyle: 'dashed',
  },

  draftBadge: {
    position: 'absolute',
    top: 14,
    alignSelf: 'center',
    backgroundColor: 'rgba(22,39,59,0.88)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 14,
  },
  draftBadgeText: { color: T.gold, fontSize: 12.5, fontWeight: '600' },

  bar: {
    backgroundColor: T.navy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 30,
  },
  barSide: { width: 96, alignItems: 'center' },
  count: { color: '#fff', fontSize: 20, fontWeight: '700' },
  countLabel: { color: '#9fb0c4', fontSize: 11 },

  shutter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },

  queueChip: {
    backgroundColor: T.navySoft,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 13,
  },
  queueChipText: { color: '#fff', fontSize: 12.5, fontWeight: '600' },

  permTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
});
