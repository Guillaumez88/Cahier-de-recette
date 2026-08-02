import { useLayoutEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import recettes from '../data/recipes.json';
import FilterBar from '../components/FilterBar';
import RecipeCard from '../components/RecipeCard';
import ShoppingHeaderButton from '../components/ShoppingHeaderButton';
import { colors, espacements } from '../theme/colors';
import { filterRecipes } from '../utils/filters';

const CRITERES_VIDES = { recherche: '', categorie: null, origine: null, difficulte: null, temps: null };

export default function HomeScreen({ navigation }) {
  const [criteres, setCriteres] = useState(CRITERES_VIDES);

  const resultats = useMemo(() => filterRecipes(recettes, criteres), [criteres]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <ShoppingHeaderButton onPress={() => navigation.navigate('ListeDeCourses')} />,
    });
  }, [navigation]);

  return (
    <FlatList
      style={styles.ecran}
      contentContainerStyle={styles.contenu}
      data={resultats}
      keyExtractor={(recette) => recette.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={styles.entete}>
          <Text style={styles.accroche}>
            {recettes.length} recettes rassemblées, avec leurs astuces et leurs variantes.
          </Text>
          <FilterBar
            recettes={recettes}
            criteres={criteres}
            onChange={setCriteres}
            nbResultats={resultats.length}
          />
        </View>
      }
      ListEmptyComponent={
        <View style={styles.vide}>
          <Text style={styles.titreVide}>Aucune recette ne correspond</Text>
          <Text style={styles.texteVide}>
            Essayez avec moins de filtres, ou un autre mot dans la recherche.
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <RecipeCard
          recette={item}
          onPress={() => navigation.navigate('Recette', { id: item.id, titre: item.titre })}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  ecran: { flex: 1, backgroundColor: colors.fond },
  contenu: { padding: espacements.lg, paddingBottom: espacements.xxl },
  entete: { gap: espacements.md, marginBottom: espacements.md },
  accroche: { fontSize: 15, color: colors.texteDoux, lineHeight: 21 },
  vide: { paddingVertical: espacements.xxl, gap: espacements.sm, alignItems: 'center' },
  titreVide: { fontSize: 17, fontWeight: '700', color: colors.texte },
  texteVide: { fontSize: 14, color: colors.texteDoux, textAlign: 'center' },
});
