import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, espacements, rayons } from '../theme/colors';
import {
  clearShoppingList,
  getShoppingList,
  grouperParRecette,
  removeArticle,
  removeRecipeFromList,
  toggleArticle,
} from '../utils/storage';

export default function ShoppingListScreen() {
  const [articles, setArticles] = useState([]);
  const [chargement, setChargement] = useState(true);

  const recharger = useCallback(() => {
    let actif = true;
    getShoppingList().then((liste) => {
      if (!actif) return;
      setArticles(liste);
      setChargement(false);
    });
    return () => {
      actif = false;
    };
  }, []);

  useFocusEffect(recharger);

  const groupes = grouperParRecette(articles);
  const restants = articles.filter((a) => !a.coche).length;

  if (chargement) {
    return (
      <View style={styles.centre}>
        <Text style={styles.texteDoux}>Chargement…</Text>
      </View>
    );
  }

  if (articles.length === 0) {
    return (
      <View style={styles.centre}>
        <Text style={styles.titreVide}>Liste de courses vide</Text>
        <Text style={styles.texteVide}>
          Ouvrez une recette et utilisez « Ajouter à la liste de courses » pour y verser ses ingrédients.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.ecran} contentContainerStyle={styles.contenu}>
      <View style={styles.barre}>
        <Text style={styles.decompte}>
          {restants} article{restants > 1 ? 's' : ''} à acheter sur {articles.length}
        </Text>
        <Pressable
          onPress={async () => setArticles(await clearShoppingList())}
          accessibilityRole="button"
          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.actionDiscrete}>Vider la liste</Text>
        </Pressable>
      </View>

      {groupes.map((groupe) => (
        <View key={groupe.recetteId} style={styles.groupe}>
          <View style={styles.enteteGroupe}>
            <Text style={styles.titreGroupe} numberOfLines={2}>
              {groupe.titre}
            </Text>
            <Pressable
              onPress={async () => setArticles(await removeRecipeFromList(groupe.recetteId))}
              accessibilityRole="button"
              accessibilityLabel={`Retirer les ingrédients de ${groupe.titre}`}
              hitSlop={8}
              style={({ pressed }) => [pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.actionDiscrete}>Retirer</Text>
            </Pressable>
          </View>

          {groupe.articles.map((article) => (
            <View key={article.cle} style={styles.ligne}>
              <Pressable
                onPress={async () => setArticles(await toggleArticle(article.cle))}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: article.coche }}
                accessibilityLabel={`${article.nom} ${article.quantite}`}
                style={styles.zoneCoche}
                hitSlop={6}
              >
                <View style={[styles.caseCoche, article.coche && styles.caseCochee]}>
                  {article.coche ? <Text style={styles.marqueCoche}>✓</Text> : null}
                </View>
                <View style={styles.texteLigne}>
                  <Text style={[styles.nom, article.coche && styles.nomCoche]}>{article.nom}</Text>
                  {article.quantite ? (
                    <Text style={[styles.quantite, article.coche && styles.nomCoche]}>{article.quantite}</Text>
                  ) : null}
                </View>
              </Pressable>

              <Pressable
                onPress={async () => setArticles(await removeArticle(article.cle))}
                accessibilityRole="button"
                accessibilityLabel={`Supprimer ${article.nom}`}
                hitSlop={8}
                style={({ pressed }) => [styles.supprimer, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.marqueSupprimer}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  ecran: { flex: 1, backgroundColor: colors.fond },
  contenu: { padding: espacements.lg, paddingBottom: espacements.xxl, gap: espacements.md },
  centre: {
    flex: 1,
    backgroundColor: colors.fond,
    alignItems: 'center',
    justifyContent: 'center',
    padding: espacements.xl,
    gap: espacements.sm,
  },
  titreVide: { fontSize: 18, fontWeight: '700', color: colors.texte },
  texteVide: { fontSize: 15, color: colors.texteDoux, textAlign: 'center', lineHeight: 22 },
  texteDoux: { fontSize: 15, color: colors.texteDoux },

  barre: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  decompte: { fontSize: 14, fontWeight: '600', color: colors.texteDoux },
  actionDiscrete: { fontSize: 14, fontWeight: '600', color: colors.terracotta },

  groupe: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.bordure,
    borderRadius: rayons.lg,
    padding: espacements.lg,
    gap: espacements.xs,
  },
  enteteGroupe: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: espacements.md,
    marginBottom: espacements.xs,
  },
  titreGroupe: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.terracottaSombre },

  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceCreuse,
  },
  zoneCoche: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: espacements.md, paddingVertical: 9 },
  caseCoche: {
    width: 22,
    height: 22,
    borderRadius: rayons.sm,
    borderWidth: 2,
    borderColor: colors.bordureForte,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caseCochee: { backgroundColor: colors.olive, borderColor: colors.olive },
  marqueCoche: { color: colors.blanc, fontSize: 13, fontWeight: '700' },
  texteLigne: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', gap: espacements.sm },
  nom: { flex: 1, fontSize: 15, color: colors.texte },
  quantite: { fontSize: 15, fontWeight: '600', color: colors.texteDoux },
  nomCoche: { color: colors.texteFaible, textDecorationLine: 'line-through' },
  supprimer: { paddingHorizontal: espacements.sm, paddingVertical: espacements.xs },
  marqueSupprimer: { fontSize: 20, color: colors.texteFaible, lineHeight: 22 },
});
