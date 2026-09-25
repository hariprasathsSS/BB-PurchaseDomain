import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppBar, Btn } from '../ui';
import { DOC_LABEL, DOC_PILL, DOC_TYPES, T, type DocType } from '../theme';
import { totalPages, useSession } from '../store';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Camera'>;

export default function CameraScreen({ navigation }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  /* What the next shot is expected to be — still just a starting point for
     Preview's own picker, not a commitment; picking "Purchase Order" here is
     the phone's equivalent of the web console's "Scan PO" button, so the
     type doesn't have to be re-picked for every capture in a run of them. */
  const [intent, setIntent] = useState<DocType>('INVOICE');
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
      if (shot?.uri) navigation.navigate('Preview', { uri: shot.uri, intent });
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

      {/* Only offered at the start of a document — once pages are being
          added to one already in progress, its type was already set on
          Preview, and switching it here would suggest it applies to a
          document it doesn't. */}
      {draftPages.length === 0 && (
        <View style={s.intentBar}>
          {DOC_TYPES.map((t) => {
            const on = t === intent;
            const c = DOC_PILL[t];
            return (
              <Pressable
                key={t}
                onPress={() => setIntent(t)}
                style={[
                  s.intentPill,
                  { backgroundColor: on ? c.bg : 'transparent', borderColor: on ? c.fg : 'rgba(255,255,255,0.3)' },
                ]}
              >
                <Text style={[s.intentPillText, { color: on ? c.fg : 'rgba(255,255,255,0.78)' }]}>
                  {DOC_LABEL[t]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

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

  intentBar: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  intentPill: {
    flex: 1, height: 34, borderRadius: T.radiusSm, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  intentPillText: { fontSize: 11.5, fontWeight: '700' },

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
    borderColor: 'rgba(127,168,204,0.9)',
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
  draftBadgeText: { color: T.accent, fontSize: 12.5, fontWeight: '600' },

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
