import type { DynamicTheme, ThemeVars } from '@mysten/dapp-kit'

const commonTheme: Pick<
  ThemeVars,
  'radii' | 'fontWeights' | 'fontSizes' | 'typography'
> = {
  radii: {
    small: '6px',
    medium: '8px',
    large: '12px',
    xlarge: '16px',
  },
  fontWeights: {
    normal: '400',
    medium: '500',
    bold: '700',
  },
  fontSizes: {
    small: '13px',
    medium: '15px',
    large: '18px',
    xlarge: '20px',
  },
  typography: {
    fontFamily:
      'Inter, "DM Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontStyle: 'normal',
    lineHeight: '1.4',
    letterSpacing: '0',
  },
}

const soulidityWalletTheme: ThemeVars = {
  ...commonTheme,
  blurs: { modalOverlay: 'blur(8px)' },
  backgroundColors: {
    primaryButton: '#7c3aed',
    primaryButtonHover: '#6d28d9',
    outlineButtonHover: '#261558',
    walletItemHover: '#261558',
    walletItemSelected: '#261558',
    modalOverlay: 'rgba(5, 3, 15, 0.78)',
    modalPrimary: '#1a1040',
    modalSecondary: '#0d0a1e',
    iconButton: 'transparent',
    iconButtonHover: '#261558',
    dropdownMenu: '#1a1040',
    dropdownMenuSeparator: '#3b2388',
  },
  borderColors: { outlineButton: '#3b2388' },
  colors: {
    primaryButton: '#ffffff',
    outlineButton: '#f8f5ff',
    body: '#f8f5ff',
    bodyMuted: '#9b8ec4',
    bodyDanger: '#f87171',
    iconButton: '#f8f5ff',
  },
  shadows: {
    primaryButton: '0 8px 24px rgba(124, 58, 237, 0.28)',
    walletItemSelected: '0 0 0 1px #7c3aed',
  },
}

const animacraftWalletTheme: ThemeVars = {
  ...commonTheme,
  blurs: { modalOverlay: 'blur(5px)' },
  backgroundColors: {
    primaryButton: '#6d4fe8',
    primaryButtonHover: '#5638cf',
    outlineButtonHover: '#eef8f4',
    walletItemHover: '#eef8f4',
    walletItemSelected: '#fffdf8',
    modalOverlay: 'rgba(33, 31, 39, 0.34)',
    modalPrimary: '#fffdf8',
    modalSecondary: '#f3f7f8',
    iconButton: 'transparent',
    iconButtonHover: '#f0eadf',
    dropdownMenu: '#fffdf8',
    dropdownMenuSeparator: '#d9d2c5',
  },
  borderColors: { outlineButton: '#211f27' },
  colors: {
    primaryButton: '#ffffff',
    outlineButton: '#211f27',
    body: '#211f27',
    bodyMuted: '#706b78',
    bodyDanger: '#b4233b',
    iconButton: '#211f27',
  },
  shadows: {
    primaryButton: '3px 3px 0 #f0a23a',
    walletItemSelected: '2px 2px 0 #2db7a3',
  },
}

export const SOULIDITY_DAPP_KIT_THEME: DynamicTheme[] = [
  {
    selector: '[data-theme="soulidity"]',
    variables: soulidityWalletTheme,
  },
  {
    selector: '[data-theme="animacraft"]',
    variables: animacraftWalletTheme,
  },
]
