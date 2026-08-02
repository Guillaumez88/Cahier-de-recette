import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, couleurCategorie, espacements, rayons } from '../theme/colors';
import { difficulteCourte, origineCourte } from '../utils/format';
import CategoryPill from './CategoryPill';

/** Vignette d'une recette dans la liste d'accueil. */
export default function RecipeCard({ recette, onPress }) {
  const teinte = couleurCategorie(recette.categorie);
  const nbIngredients = (recette.ingredients || []).reduce(
    (total, groupe) => total + (groupe.items || []).length,
    0
  );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${recette.titre}, ${recette.categorie}`}
      style={({ pressed }) => [styles.carte, pressed && styles.pressee]}
    >
      <View style={[styles.liseret, { backgroundColor: teinte }]} />

      <View style={styles.corps}>
        <View style={styles.enTete}>
          <CategoryPill libelle={recette.categorie} teinte={teinte} active compacte />
          <Text style={styles.temps}>{recette.temps.total}</Text>
        </View>

        <Text style={styles.titre} numberOfLines={2}>
          {recette.titre}
        </Text>

        <Text style={styles.meta} numberOfLines={1}>
          {origineCourte(recette.origine)} · {difficulteCourte(recette.difficulte)} · {recette.portions}
        </Text>

        <Text style={styles.metaFaible}>
          {nbIngredients} ingrédients · {recette.instructions.length} étapes
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  carte: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: rayons.lg,
    borderWidth: 1,
    borderColor: colors.bordure,
    overflow: 'hidden',
    marginBottom: espacements.md,
  },
  pressee: { opacity: 0.85 },
  liseret: { width: 6 },
  corps: { flex: 1, padding: espacements.lg, gap: espacements.xs },
  enTete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: espacements.sm },
  temps: { fontSize: 13, fontWeight: '600', color: colors.texteDoux },
  titre: { fontSize: 18, fontWeight: '700', color: colors.texte, marginTop: espacements.xs },
  meta: { fontSize: 13, color: colors.texteDoux },
  metaFaible: { fontSize: 12, color: colors.texteFaible },
});
