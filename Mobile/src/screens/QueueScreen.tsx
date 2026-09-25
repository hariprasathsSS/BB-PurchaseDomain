import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppBar, Btn, Card, ErrorNote, Pill } from '../ui';
import { T } from '../theme';
import { totalPages, useSession } from '../store';
import { batchUpload } from '../api';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Queue'>;

export default function QueueScreen({ navigation }: Props) {
  const { serverUrl, token, queue } = useSession();
  const removeDoc = useSession((s) => s.removeDoc);
  const clearQueue = useSession((s) => s.clearQueue);
  const disconnect = useSession((s) => s.disconnect);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);

  async function send() {
    if (!serverUrl || !token) {
      setError('Not connected. Scan the QR code again.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await batchUpload(serverUrl, token, queue);
      setSent(result.total);
      clearQueue();
    } catch (err: any) {
      setError(err?.message ?? 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  /* ── success state ─────────────────────────────────────────────────── */
  if (sent !== null) {
    return (
      <View style={s.root}>
        <AppBar title="Sent" />
        <View style={s.center}>
          <Card style={{ alignItems: 'center', paddingVertical: 30 }}>
            <View style={s.tick}>
              <Text style={s.tickMark}>✓</Text>
            </View>
            <Text style={s.okTitle}>
              {sent} document{sent === 1 ? '' : 's'} sent
            </Text>
            <Text style={s.okBody}>The office can now review them on the web application.</Text>

            <Btn
              label="Scan more documents"
              onPress={() => {
                setSent(null);
                navigation.navigate('Camera');
              }}
              style={{ marginTop: 22, alignSelf: 'stretch' }}
            />
            <Btn
              label="Done — disconnect"
              tone="ghost"
              onPress={() => {
                disconnect();
                navigation.reset({ index: 0, routes: [{ name: 'Connect' }] });
              }}
              style={{ marginTop: 10, alignSelf: 'stretch' }}
            />
          </Card>
        </View>
      </View>
    );
  }

  /* ── queue list ────────────────────────────────────────────────────── */
  return (
    <View style={s.root}>
      <AppBar title="Ready to Send" onBack={() => navigation.goBack()} />

      <View style={s.summary}>
        <Text style={s.summaryText}>
          {queue.length} document{queue.length === 1 ? '' : 's'} · {totalPages(queue)} page
          {totalPages(queue) === 1 ? '' : 's'}
        </Text>
      </View>

      <ScrollView contentContainerStyle={s.list}>
        {queue.length === 0 && (
          <Text style={s.empty}>Nothing scanned yet. Go back and capture a document.</Text>
        )}

        {queue.map((doc) => (
          <View key={doc.id} style={s.row}>
            <Image source={{ uri: doc.pages[0] }} style={s.thumb} />

            <View style={{ flex: 1 }}>
              <Pill type={doc.documentType} />
              <Text style={s.rowMeta}>
                {doc.pages.length} page{doc.pages.length === 1 ? '' : 's'}
              </Text>
              {!!doc.notes && (
                <Text style={s.rowNotes} numberOfLines={1}>
                  {doc.notes}
                </Text>
              )}
            </View>

            <Pressable onPress={() => removeDoc(doc.id)} hitSlop={10} style={s.remove}>
              <Text style={s.removeText}>✕</Text>
            </Pressable>
          </View>
        ))}

        <ErrorNote message={error} />
      </ScrollView>

      <View style={s.footer}>
        <Btn
          label="+ Scan more"
          tone="ghost"
          onPress={() => navigation.navigate('Camera')}
          style={{ flex: 1 }}
        />
        <Btn
          label={busy ? 'Sending…' : 'Send All'}
          onPress={send}
          busy={busy}
          disabled={queue.length === 0}
          style={{ flex: 1.3 }}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.page },
  center: { flex: 1, justifyContent: 'center', padding: 20 },

  summary: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: T.borderSoft,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
  },
  summaryText: { fontSize: 12.5, fontWeight: '700', color: T.navy },

  list: { padding: 16, paddingBottom: 24 },
  empty: { textAlign: 'center', color: T.muted, fontSize: 13, paddingVertical: 40 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.borderSoft,
    borderRadius: T.radius,
    padding: 10,
    marginBottom: 10,
  },
  thumb: { width: 52, height: 62, borderRadius: 4, backgroundColor: '#dde4ec' },
  rowMeta: { marginTop: 5, fontSize: 12.5, color: T.text, fontWeight: '600' },
  rowNotes: { marginTop: 2, fontSize: 12, color: T.muted },
  remove: { padding: 6 },
  removeText: { color: T.red, fontSize: 17, fontWeight: '700' },

  footer: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    paddingBottom: 28,
    backgroundColor: T.card,
    borderTopWidth: 1,
    borderTopColor: T.border,
  },

  tick: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: T.okBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  tickMark: { fontSize: 38, color: T.ok, fontWeight: '700' },
  okTitle: { fontSize: 18, fontWeight: '700', color: T.text },
  okBody: { fontSize: 13.5, color: T.muted, textAlign: 'center', marginTop: 6, lineHeight: 19 },
});
