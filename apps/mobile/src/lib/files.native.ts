import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Phone: write the file and open the share sheet (save to Drive, Files, WhatsApp, …). */
export async function saveTextFile(name: string, text: string, mime = 'application/json'): Promise<void> {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: name });
}

export async function pickTextFile(): Promise<string | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', '*/*'], copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.[0]) return null;
  return new File(res.assets[0].uri).text();
}
