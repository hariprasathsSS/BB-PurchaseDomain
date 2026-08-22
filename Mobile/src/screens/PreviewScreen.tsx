import { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppBar, Btn } from '../ui';
import { DOC_LABEL, DOC_PILL, DOC_TYPES, T, type DocType } from '../theme';
import { useSession } from '../store';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Preview'>;

export default function PreviewScreen({ route, navigation }: Props) {
  const { uri } = route.params;
  const [docType, setDocType] = useState<DocType>('INVOICE');
  const [notes, setNotes] = useState('');

  const draftPages = useSession((s) => s.draftPages);
  const addDraftPage = useSession((s) => s.addDraftPage);
  const commitDraft = useSession((s) => s.commitDraft);

  const pageNo = draftPages.length + 1;

  function addPage() {
    addDraftPage(uri);
    navigation.navigate('Camera');
  }

  function addToQueue() {
    commitDraft(uri, docType, notes.trim());
    navigation.navigate('Camera');
  }

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AppBar
        title={pageNo > 1 ? `Preview — page ${pageNo}` : 'Preview'}
        onBack={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.shot}>
          <Image source={{ uri }} style={s.image} resizeMode="contain" />
        </View>

        {pageNo > 1 && (
          <Text style={s.pageNote}>
            {draftPages.length} page{draftPages.length === 1 ? '' : 's'} already captured for this
            document.
          </Text>
        )}

        <Text style={s.label}>Document type</Text>
        <View style={s.types}>
          {DOC_TYPES.map((t) => {
            const on = t === docType;
            const c = DOC_PILL[t];
            return (
              <Pressable
                key={t}
                onPress={() => setDocType(t)}
                style={[
                  s.type,
                  { backgroundColor: on ? c.bg : T.card, borderColor: on ? c.fg : T.border },
                ]}
              >
                <Text style={[s.typeText, { color: on ? c.fg : T.muted }]}>{DOC_LABEL[t]}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={s.label}>Notes (optional)</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="e.g. vendor name or site"
          placeholderTextColor={T.muted}
          style={s.input}
        />

        <View style={s.actions}>
          <Btn
            label="Retake"
            tone="ghost"
            onPress={() => navigation.goBack()}
            style={{ flex: 1 }}
          />
          <Btn label="+ Add page" tone="blue" onPress={addPage} style={{ flex: 1 }} />
        </View>

        <Btn
          label={pageNo > 1 ? `Add ${pageNo}-page document to queue` : 'Add to Queue'}
          onPress={addToQueue}
          style={{ marginTop: 10 }}
        />

        <Text style={s.hint}>
          Use <Text style={s.hintStrong}>+ Add page</Text> when the document continues onto
          another sheet — both pages stay together as one document.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.page },
  scroll: { padding: 16, paddingBottom: 36 },

  shot: {
    backgroundColor: '#0d1724',
    borderRadius: T.radius,
    overflow: 'hidden',
    height: 320,
  },
  image: { width: '100%', height: '100%' },

  pageNote: { marginTop: 10, fontSize: 12.5, color: T.blueDark, fontWeight: '600' },

  label: { marginTop: 18, marginBottom: 8, fontSize: 12, fontWeight: '700', color: T.muted },

  types: { flexDirection: 'row', gap: 8 },
  type: {
    flex: 1,
    height: 42,
    borderRadius: T.radiusSm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeText: { fontSize: 12.5, fontWeight: '700' },

  input: {
    height: 46,
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: T.radiusSm,
    paddingHorizontal: 12,
    fontSize: 14,
    color: T.text,
  },

  actions: { flexDirection: 'row', gap: 10, marginTop: 22 },

  hint: { marginTop: 14, fontSize: 12, color: T.muted, lineHeight: 18 },
  hintStrong: { fontWeight: '700', color: T.text },
});
