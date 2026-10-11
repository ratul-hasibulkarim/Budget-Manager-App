export type ThemeName = 'light' | 'black' | 'maroon' | 'blue' | 'green';

export interface Theme {
  name: ThemeName;
  dark: boolean;
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  onPrimary: string;
  /** Top bar background. */
  header: string;
  onHeader: string;
  positive: string;
  negative: string;
  warning: string;
}

export const THEMES: Record<ThemeName, Theme> = {
  light: {
    name: 'light',
    dark: false,
    bg: '#F5F6F8',
    surface: '#FFFFFF',
    surfaceAlt: '#EEF0F3',
    text: '#14171C',
    textMuted: '#5D6672',
    border: '#DCE0E5',
    primary: '#2A5BD7',
    onPrimary: '#FFFFFF',
    header: '#FFFFFF',
    onHeader: '#14171C',
    positive: '#127A3E',
    negative: '#C0362C',
    warning: '#A86400',
  },
  black: {
    name: 'black',
    dark: true,
    bg: '#000000',
    surface: '#121417',
    surfaceAlt: '#1D2025',
    text: '#F2F4F7',
    textMuted: '#9AA3AE',
    border: '#2A2E35',
    primary: '#7FA6FF',
    onPrimary: '#0B0D10',
    header: '#0B0D10',
    onHeader: '#F2F4F7',
    positive: '#4CD083',
    negative: '#FF7A70',
    warning: '#F2B544',
  },
  maroon: {
    name: 'maroon',
    dark: false,
    bg: '#FBF5F5',
    surface: '#FFFFFF',
    surfaceAlt: '#F4E7E8',
    text: '#2A1214',
    textMuted: '#6E5557',
    border: '#E9D5D7',
    primary: '#7A1F2B',
    onPrimary: '#FFFFFF',
    header: '#7A1F2B',
    onHeader: '#FFFFFF',
    positive: '#1F7A45',
    negative: '#B3261E',
    warning: '#9A5B00',
  },
  blue: {
    name: 'blue',
    dark: false,
    bg: '#F3F7FC',
    surface: '#FFFFFF',
    surfaceAlt: '#E3EDF8',
    text: '#0F1D2E',
    textMuted: '#4F6278',
    border: '#D2DFEE',
    primary: '#1259B8',
    onPrimary: '#FFFFFF',
    header: '#1259B8',
    onHeader: '#FFFFFF',
    positive: '#127A3E',
    negative: '#C0362C',
    warning: '#9A5B00',
  },
  green: {
    name: 'green',
    dark: false,
    bg: '#F3F8F5',
    surface: '#FFFFFF',
    surfaceAlt: '#E2F0E7',
    text: '#10221A',
    textMuted: '#4E6659',
    border: '#D0E3D7',
    primary: '#1E6B4A',
    onPrimary: '#FFFFFF',
    header: '#1E6B4A',
    onHeader: '#FFFFFF',
    positive: '#1E7A45',
    negative: '#B3261E',
    warning: '#9A5B00',
  },
};

export const THEME_ORDER: ThemeName[] = ['light', 'black', 'maroon', 'blue', 'green'];

export const FONT = {
  regular: 'HindSiliguri_400Regular',
  medium: 'HindSiliguri_500Medium',
  semibold: 'HindSiliguri_600SemiBold',
  bold: 'HindSiliguri_700Bold',
};
