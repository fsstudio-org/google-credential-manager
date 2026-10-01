import type { ReactNode } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

export type GoogleSignInButtonTheme = 'light' | 'dark';
export type GoogleSignInButtonShape = 'rectangular' | 'pill';
export type GoogleSignInButtonSize = 'small' | 'medium' | 'large';
export type GoogleSignInButtonVariant = 'standard' | 'icon';
export type GoogleSignInButtonLabel = 'signin' | 'signup' | 'continue';

/**
 * Fixed by Google's branding guidelines, and exported so composing your own
 * button doesn't mean hard-coding hex values.
 *
 * @see https://developers.google.com/identity/branding-guidelines
 */
export const googleSignInButtonThemes = {
  light: {
    background: '#FFFFFF',
    border: '#747775',
    text: '#1F1F1F',
  },
  dark: {
    background: '#131314',
    border: '#8E918F',
    text: '#E3E3E3',
  },
} as const;

/** Metrics per size. Exported for the same reason as the themes. */
export const googleSignInButtonSizes = {
  small: { height: 32, logo: 16, fontSize: 12, paddingHorizontal: 10, gap: 8 },
  medium: {
    height: 40,
    logo: 20,
    fontSize: 14,
    paddingHorizontal: 12,
    gap: 12,
  },
  large: { height: 48, logo: 24, fontSize: 16, paddingHorizontal: 16, gap: 12 },
} as const;

/** The three strings Google permits. */
export const googleSignInButtonLabels: Record<GoogleSignInButtonLabel, string> =
  {
    signin: 'Sign in with Google',
    signup: 'Sign up with Google',
    continue: 'Continue with Google',
  };

export interface GoogleSignInButtonProps
  extends Omit<PressableProps, 'style' | 'children'> {
  onPress: () => void;
  /** `'standard'` is logo + text; `'icon'` is a square logo-only button. */
  variant?: GoogleSignInButtonVariant;
  /** Default `'light'`. */
  theme?: GoogleSignInButtonTheme;
  /** Default `'rectangular'` (4pt radius). `'pill'` is fully rounded. */
  shape?: GoogleSignInButtonShape;
  /** Default `'medium'` (40pt tall). */
  size?: GoogleSignInButtonSize;
  /** Which of Google's three sanctioned strings to show. Default `'signin'`. */
  label?: GoogleSignInButtonLabel;
  /** Overrides the label text. Google's guidelines restrict the wording. */
  text?: string;
  /** Stretches to fill the container. Ignored by the `'icon'` variant. */
  fullWidth?: boolean;
  /** Merged over the defaults. Accepts Pressable's function form. */
  style?:
    | StyleProp<ViewStyle>
    | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
  /** Merged over the default label style. */
  textStyle?: StyleProp<TextStyle>;
  /** Overrides the logo size implied by `size`. */
  logoSize?: number;
  /** Replaces the logo, e.g. with your own mark. */
  logo?: ReactNode;
  /** Replaces the entire content, leaving only the pressable surface. */
  children?: ReactNode | ((state: PressableStateCallbackType) => ReactNode);
}

/** The official four-colour "G", exported so you can compose your own button. */
export function GoogleGLogo({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <Path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <Path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <Path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </Svg>
  );
}

/**
 * Branding-compliant "Sign in with Google" button. Requires `react-native-svg`,
 * which is why it sits behind its own subpath export.
 *
 * The defaults follow Google's guidelines; the overrides exist because you may
 * have a good reason, and the compliance decision is yours.
 *
 * ```tsx
 * <GoogleSignInButton onPress={signIn} />
 * <GoogleSignInButton onPress={signIn} variant="icon" theme="dark" shape="pill" />
 * <GoogleSignInButton onPress={signIn} size="large" label="continue" fullWidth />
 * ```
 */
export function GoogleSignInButton({
  onPress,
  variant = 'standard',
  theme = 'light',
  shape = 'rectangular',
  size = 'medium',
  label = 'signin',
  text,
  disabled = false,
  fullWidth = false,
  style,
  textStyle,
  logoSize,
  logo,
  children,
  ...pressableProps
}: GoogleSignInButtonProps) {
  const palette = googleSignInButtonThemes[theme];
  const metrics = googleSignInButtonSizes[size];
  const content = text ?? googleSignInButtonLabels[label];
  const isIcon = variant === 'icon';

  const base: ViewStyle = {
    height: metrics.height,
    backgroundColor: palette.background,
    borderColor: palette.border,
    borderRadius: shape === 'pill' ? metrics.height / 2 : 4,
    paddingHorizontal: isIcon ? 0 : metrics.paddingHorizontal,
    ...(isIcon ? { width: metrics.height, justifyContent: 'center' } : null),
  };

  const renderLogo = () =>
    logo ?? <GoogleGLogo size={logoSize ?? metrics.logo} />;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={content}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      {...pressableProps}
      style={(state) => [
        styles.button,
        base,
        fullWidth && !isIcon && styles.fullWidth,
        // Google's spec has no pressed colour, so dim rather than invent one.
        state.pressed && styles.pressed,
        disabled && styles.disabled,
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      {(state) => {
        if (children) {
          return typeof children === 'function' ? children(state) : children;
        }
        if (isIcon) {
          return renderLogo();
        }
        return (
          <>
            <View style={{ marginRight: metrics.gap }}>{renderLogo()}</View>
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                { color: palette.text, fontSize: metrics.fontSize },
                textStyle,
              ]}
            >
              {content}
            </Text>
          </>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
  },
  fullWidth: {
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.38,
  },
  label: {
    // Google specifies Roboto Medium; shipping a font file with an auth library
    // isn't worth it, so this uses the platform UI font at the same weight.
    // Spread rather than `fontFamily: undefined`, which `exactOptionalPropertyTypes`
    // rejects.
    ...Platform.select({
      android: { fontFamily: 'sans-serif-medium' },
      default: {},
    }),
    fontWeight: '500',
    letterSpacing: 0.25,
  },
});
