import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, espacements, rayons } from '../theme/colors';
import { getShoppingList } from '../utils/storage';

/**
 * Bouton d'en-tête vers la liste de courses, avec le nombre d'articles restant à
 * acheter. Le compteur est relu à chaque retour sur l'écran (useFocusEffect)
 * plutôt que maintenu dans un état global : AsyncStorage est la source de vérité.
 */
export default function ShoppingHeaderButton({ onPress }) {
  const [nbRestants, setNbRestants] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let actif = true;
      getShoppingList().then((articles) => {
        if (actif) setNbRestants(articles.filter((a) => !a.coche).length);
      });
      return () => {
        actif = false;
      };
    }, [])
  );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Liste de courses, ${nbRestants} article${nbRestants > 1 ? 's' : ''} à acheter`}
      style={({ pressed }) => [styles.bouton, pressed && { opacity: 0.6 }]}
      hitSlop={8}
    >
      <Text style={styles.libelle}>Courses</Text>
      {nbRestants > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.texteBadge}>{nbRestants}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bouton: { flexDirection: 'row', alignItems: 'center', gap: espacements.xs, paddingHorizontal: espacements.sm },
  libelle: { fontSize: 16, fontWeight: '600', color: colors.terracotta },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: rayons.pilule,
    backgroundColor: colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texteBadge: { color: colors.blanc, fontSize: 11, fontWeight: '700' },
});
