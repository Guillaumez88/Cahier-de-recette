import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, couleurCategorie, espacements, rayons } from '../theme/colors';
import { TRANCHES_TEMPS } from '../utils/format';
import { optionsDisponibles } from '../utils/filters';
import CategoryPill from './CategoryPill';

/**
 * Recherche et filtres. Pas de <select> natif sur mobile : chaque critère est
 * rendu en rangée de puces défilante horizontalement. Un appui sur une puce déjà
 * active la désactive.
 */
export default function FilterBar({ recettes, criteres, onChange, nbResultats }) {
  const options = useMemo(() => optionsDisponibles(recettes), [recettes]);

  const basculer = (champ, valeur) => {
    onChange({ ...criteres, [champ]: criteres[champ] === valeur ? null : valeur });
  };

  const auMoinsUnFiltre =
    Boolean(criteres.recherche) ||
    Boolean(criteres.categorie) ||
    Boolean(criteres.origine) ||
    Boolean(criteres.difficulte) ||
    Boolean(criteres.temps);

  const rangees = [
    {
      cle: 'categorie',
      titre: 'Catégorie',
      valeurs: options.categories.map((v) => ({ valeur: v, libelle: v, teinte: couleurCategorie(v) })),
    },
    {
      cle: 'origine',
      titre: 'Origine',
      valeurs: options.origines.map((v) => ({ valeur: v, libelle: v })),
    },
    {
      cle: 'difficulte',
      titre: 'Difficulté',
      valeurs: options.difficultes.map((v) => ({ valeur: v, libelle: v })),
    },
    {
      cle: 'temps',
      titre: 'Temps total',
      valeurs: TRANCHES_TEMPS.map((t) => ({ valeur: t.cle, libelle: t.libelle })),
    },
  ];

  return (
    <View style={styles.bloc}>
      <TextInput
        value={criteres.recherche || ''}
        onChangeText={(texte) => onChange({ ...criteres, recherche: texte })}
        placeholder="Rechercher un plat, un ingrédient…"
        placeholderTextColor={colors.texteFaible}
        style={styles.champ}
        accessibilityLabel="Rechercher une recette"
        returnKeyType="search"
        clearButtonMode="while-editing"
      />

      {rangees.map((rangee) => (
        <View key={rangee.cle} style={styles.rangee}>
          <Text style={styles.titreRangee}>{rangee.titre}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pilules}
          >
            {rangee.valeurs.map((option) => (
              <CategoryPill
                key={option.valeur}
                libelle={option.libelle}
                teinte={option.teinte}
                active={criteres[rangee.cle] === option.valeur}
                onPress={() => basculer(rangee.cle, option.valeur)}
              />
            ))}
          </ScrollView>
        </View>
      ))}

      <View style={styles.pied}>
        <Text style={styles.decompte}>
          {nbResultats} recette{nbResultats > 1 ? 's' : ''}
        </Text>
        {auMoinsUnFiltre ? (
          <Pressable
            onPress={() =>
              onChange({ recherche: '', categorie: null, origine: null, difficulte: null, temps: null })
            }
            accessibilityRole="button"
            style={({ pressed }) => [styles.reinitialiser, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.texteReinitialiser}>Tout effacer</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bloc: { gap: espacements.md, paddingBottom: espacements.sm },
  champ: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.bordureForte,
    borderRadius: rayons.md,
    paddingHorizontal: espacements.lg,
    paddingVertical: espacements.md,
    fontSize: 16,
    color: colors.texte,
  },
  rangee: { gap: espacements.xs },
  titreRangee: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.texteFaible,
  },
  pilules: { gap: espacements.sm, paddingRight: espacements.lg },
  pied: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  decompte: { fontSize: 14, fontWeight: '600', color: colors.texteDoux },
  reinitialiser: { paddingVertical: espacements.xs, paddingHorizontal: espacements.sm },
  texteReinitialiser: { fontSize: 14, fontWeight: '600', color: colors.terracotta },
});
