import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, rayons, espacements } from '../theme/colors';

/**
 * Puce de filtre. Sert aussi d'étiquette simple quand `onPress` n'est pas fourni.
 * `teinte` permet de colorer la puce par catégorie.
 */
export default function CategoryPill({ libelle, active = false, onPress, teinte, compacte = false }) {
  const couleur = teinte || colors.terracotta;

  const contenu = (
    <Text
      style={[
        styles.texte,
        compacte && styles.texteCompact,
        active ? { color: colors.blanc } : { color: couleur },
      ]}
      numberOfLines={1}
    >
      {libelle}
    </Text>
  );

  const style = [
    styles.pilule,
    compacte && styles.piluleCompacte,
    { borderColor: couleur },
    active && { backgroundColor: couleur },
  ];

  if (!onPress) return <Text style={style}>{contenu}</Text>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={libelle}
      style={({ pressed }) => [...style, pressed && styles.pressee]}
    >
      {contenu}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pilule: {
    borderWidth: 1,
    borderRadius: rayons.pilule,
    paddingVertical: 6,
    paddingHorizontal: espacements.md,
    backgroundColor: colors.surface,
  },
  piluleCompacte: { paddingVertical: 3, paddingHorizontal: espacements.sm },
  texte: { fontSize: 14, fontWeight: '600' },
  texteCompact: { fontSize: 12 },
  pressee: { opacity: 0.7 },
});
