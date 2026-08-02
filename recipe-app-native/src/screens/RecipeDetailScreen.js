import { useCallback, useLayoutEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import recettes from '../data/recipes.json';
import BoldText from '../components/BoldText';
import CategoryPill from '../components/CategoryPill';
import FlowView from '../components/FlowView';
import ShoppingHeaderButton from '../components/ShoppingHeaderButton';
import { colors, couleurCategorie, espacements, rayons } from '../theme/colors';
import { isFlowTableInformative } from '../utils/flow';
import { difficulteCourte, origineCourte, stripTipPrefix } from '../utils/format';
import { addRecipeToList, getShoppingList, removeRecipeFromList, recetteDansListe } from '../utils/storage';

/** Bloc de section avec titre, utilisé pour toute la fiche. */
function Section({ titre, sousTitre, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.titreSection}>{titre}</Text>
      {sousTitre ? <Text style={styles.sousTitreSection}>{sousTitre}</Text> : null}
      {children}
    </View>
  );
}

/** Liste à puces simple, ne rend rien si la liste est vide. */
function ListePuces({ elements }) {
  if (!elements || elements.length === 0) return null;
  return (
    <View style={styles.puces}>
      {elements.map((element, index) => (
        <View key={index} style={styles.lignePuce}>
          <Text style={styles.marquePuce}>·</Text>
          <BoldText style={styles.textePuce}>{element}</BoldText>
        </View>
      ))}
    </View>
  );
}

export default function RecipeDetailScreen({ route, navigation }) {
  const { id } = route.params;
  const recette = recettes.find((r) => r.id === id);

  const [dansListe, setDansListe] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: recette ? recette.titre : 'Recette',
      headerRight: () => <ShoppingHeaderButton onPress={() => navigation.navigate('ListeDeCourses')} />,
    });
  }, [navigation, recette]);

  useFocusEffect(
    useCallback(() => {
      let actif = true;
      getShoppingList().then((articles) => {
        if (actif) setDansListe(recetteDansListe(articles, id));
      });
      return () => {
        actif = false;
      };
    }, [id])
  );

  if (!recette) {
    return (
      <View style={styles.absente}>
        <Text style={styles.titreAbsente}>Recette introuvable</Text>
        <Text style={styles.texteAbsente}>L'identifiant « {String(id)} » ne correspond à aucune fiche.</Text>
      </View>
    );
  }

  const teinte = couleurCategorie(recette.categorie);

  const basculerListe = async () => {
    if (dansListe) {
      await removeRecipeFromList(recette.id);
      setDansListe(false);
    } else {
      await addRecipeToList(recette);
      setDansListe(true);
    }
  };

  const lignesTemps = [
    ['Préparation', recette.temps.preparation],
    ['Cuisson', recette.temps.cuisson],
    ['Repos', recette.temps.repos],
    ['Total', recette.temps.total],
  ].filter(([, valeur]) => Boolean(valeur));

  const flowUtile = isFlowTableInformative(recette.flowTable);

  return (
    <ScrollView style={styles.ecran} contentContainerStyle={styles.contenu}>
      <View style={styles.entete}>
        <View style={styles.rangeeEtiquettes}>
          <CategoryPill libelle={recette.categorie} teinte={teinte} active compacte />
          <CategoryPill libelle={origineCourte(recette.origine)} compacte />
          <CategoryPill libelle={difficulteCourte(recette.difficulte)} compacte />
        </View>

        <Text style={styles.titre}>{recette.titre}</Text>
        <Text style={styles.portions}>{recette.portions}</Text>
      </View>

      <Pressable
        onPress={basculerListe}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.bouton,
          dansListe ? styles.boutonSecondaire : styles.boutonPrincipal,
          pressed && { opacity: 0.8 },
        ]}
      >
        <Text style={[styles.texteBouton, dansListe && styles.texteBoutonSecondaire]}>
          {dansListe ? 'Retirer de la liste de courses' : 'Ajouter à la liste de courses'}
        </Text>
      </Pressable>

      <Section titre="Temps">
        <View style={styles.tableau}>
          {lignesTemps.map(([libelle, valeur]) => (
            <View key={libelle} style={styles.ligneTableau}>
              <Text style={styles.celluleLibelle}>{libelle}</Text>
              <Text style={styles.celluleValeur}>{valeur}</Text>
            </View>
          ))}
        </View>
      </Section>

      <Section titre="Origine">
        <Text style={styles.paragraphe}>{recette.origine}</Text>
        {recette.difficulte ? (
          <Text style={styles.paragrapheFaible}>Difficulté indiquée : {recette.difficulte}</Text>
        ) : null}
        {recette.calories ? (
          <Text style={styles.paragrapheFaible}>Calories : {recette.calories}</Text>
        ) : null}
      </Section>

      <Section titre="Ingrédients">
        {recette.ingredients.map((groupe, index) => (
          <View key={index} style={styles.groupeIngredients}>
            {groupe.groupe ? <Text style={styles.titreGroupe}>{groupe.groupe}</Text> : null}
            {groupe.items.map((item, i) => (
              <View key={i} style={styles.ligneIngredient}>
                <Text style={styles.nomIngredient}>{item.nom}</Text>
                <Text style={styles.quantiteIngredient}>{item.quantite}</Text>
              </View>
            ))}
          </View>
        ))}
      </Section>

      <Section titre="Préparation">
        {recette.instructions.map((etape, index) => (
          <View key={index} style={styles.etape}>
            <View style={styles.numeroEtape}>
              {/* `numero` vaut parfois un libellé plutôt qu'un entier
                  (« Pour finir » dans la source des lasagnes bolognaise). */}
              <Text style={styles.texteNumeroEtape} numberOfLines={1}>
                {typeof etape.numero === 'number' ? etape.numero : '•'}
              </Text>
            </View>
            <View style={styles.corpsEtape}>
              {typeof etape.numero !== 'number' ? (
                <Text style={styles.libelleEtape}>{String(etape.numero)}</Text>
              ) : null}
              <BoldText style={styles.texteEtape}>{etape.texte}</BoldText>
              {etape.astuce ? (
                <View style={styles.astuceEtape}>
                  <Text style={styles.marqueAstuce}>Astuce</Text>
                  <BoldText style={styles.texteAstuce}>{stripTipPrefix(etape.astuce)}</BoldText>
                </View>
              ) : null}
            </View>
          </View>
        ))}
      </Section>

      {flowUtile ? (
        <Section
          titre="Déroulé des préparations"
          sousTitre="Quels ingrédients suivent la même action, et dans quel ordre tout s'assemble."
        >
          <FlowView flowTable={recette.flowTable} />
        </Section>
      ) : null}

      {recette.astuces.recette.length > 0 ? (
        <Section titre="Astuces de la recette">
          <ListePuces elements={recette.astuces.recette} />
        </Section>
      ) : null}

      {recette.astuces.commentaires.length > 0 ? (
        <Section titre="Astuces tirées des commentaires">
          <ListePuces elements={recette.astuces.commentaires} />
        </Section>
      ) : null}

      {recette.variantes.recette.length > 0 ? (
        <Section titre="Variantes">
          <ListePuces elements={recette.variantes.recette} />
        </Section>
      ) : null}

      {recette.variantes.associees.length > 0 ? (
        <Section titre="Recettes associées" sousTitre="Suggestions présentes sur la page source.">
          <ListePuces elements={recette.variantes.associees} />
        </Section>
      ) : null}

      {recette.manquants.length > 0 ? (
        <Section titre="Ce que la source ne donne pas" sousTitre="Signalé plutôt que comblé par une hypothèse.">
          <ListePuces elements={recette.manquants} />
        </Section>
      ) : null}

      <Section titre="Source">
        <Pressable
          onPress={() => Linking.openURL(recette.source.url)}
          accessibilityRole="link"
          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.lien}>{recette.source.label}</Text>
          <Text style={styles.urlSource}>{recette.source.url}</Text>
        </Pressable>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  ecran: { flex: 1, backgroundColor: colors.fond },
  contenu: { padding: espacements.lg, paddingBottom: espacements.xxl, gap: espacements.lg },

  entete: { gap: espacements.sm },
  rangeeEtiquettes: { flexDirection: 'row', flexWrap: 'wrap', gap: espacements.sm },
  titre: { fontSize: 24, fontWeight: '700', color: colors.texte, lineHeight: 31 },
  portions: { fontSize: 15, color: colors.texteDoux },

  bouton: { borderRadius: rayons.md, paddingVertical: espacements.md, alignItems: 'center', borderWidth: 1 },
  boutonPrincipal: { backgroundColor: colors.terracotta, borderColor: colors.terracotta },
  boutonSecondaire: { backgroundColor: colors.surface, borderColor: colors.terracotta },
  texteBouton: { fontSize: 16, fontWeight: '700', color: colors.blanc },
  texteBoutonSecondaire: { color: colors.terracotta },

  section: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.bordure,
    borderRadius: rayons.lg,
    padding: espacements.lg,
    gap: espacements.sm,
  },
  titreSection: { fontSize: 17, fontWeight: '700', color: colors.terracottaSombre },
  sousTitreSection: { fontSize: 13, color: colors.texteFaible, lineHeight: 18 },

  tableau: { borderTopWidth: 1, borderTopColor: colors.bordure },
  ligneTableau: {
    flexDirection: 'row',
    gap: espacements.md,
    paddingVertical: espacements.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.bordure,
  },
  celluleLibelle: { width: 100, fontSize: 14, fontWeight: '600', color: colors.texteDoux },
  celluleValeur: { flex: 1, fontSize: 14, color: colors.texte, lineHeight: 20 },

  paragraphe: { fontSize: 15, color: colors.texte, lineHeight: 22 },
  paragrapheFaible: { fontSize: 13, color: colors.texteDoux, lineHeight: 19 },

  groupeIngredients: { gap: espacements.xs, marginBottom: espacements.sm },
  titreGroupe: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.texteFaible,
    marginTop: espacements.xs,
  },
  ligneIngredient: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: espacements.md,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceCreuse,
  },
  nomIngredient: { flex: 1, fontSize: 15, color: colors.texte },
  quantiteIngredient: { fontSize: 15, fontWeight: '600', color: colors.terracottaSombre },

  etape: { flexDirection: 'row', gap: espacements.md, marginBottom: espacements.md },
  numeroEtape: {
    width: 28,
    height: 28,
    borderRadius: rayons.pilule,
    backgroundColor: colors.terracottaClair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texteNumeroEtape: { fontSize: 14, fontWeight: '700', color: colors.terracottaSombre },
  corpsEtape: { flex: 1, gap: espacements.xs },
  libelleEtape: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.terracotta,
  },
  texteEtape: { fontSize: 15, color: colors.texte, lineHeight: 23 },
  astuceEtape: {
    backgroundColor: colors.surfaceCreuse,
    borderRadius: rayons.sm,
    padding: espacements.md,
    gap: 2,
    marginTop: espacements.xs,
  },
  marqueAstuce: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.olive,
  },
  texteAstuce: { fontSize: 14, color: colors.texte, lineHeight: 21 },

  puces: { gap: espacements.xs },
  lignePuce: { flexDirection: 'row', gap: espacements.sm },
  marquePuce: { fontSize: 15, color: colors.terracotta, lineHeight: 22 },
  textePuce: { flex: 1, fontSize: 15, color: colors.texte, lineHeight: 22 },

  lien: { fontSize: 15, fontWeight: '700', color: colors.terracotta },
  urlSource: { fontSize: 12, color: colors.texteFaible, marginTop: 2 },

  absente: { flex: 1, backgroundColor: colors.fond, padding: espacements.xl, gap: espacements.sm },
  titreAbsente: { fontSize: 18, fontWeight: '700', color: colors.texte },
  texteAbsente: { fontSize: 15, color: colors.texteDoux },
});
