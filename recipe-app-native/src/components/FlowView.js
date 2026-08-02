import { StyleSheet, Text, View } from 'react-native';

import { colors, espacements, rayons } from '../theme/colors';
import { buildFlowPhases } from '../utils/flow';

/**
 * Rend le tableau de flux sous forme de timeline verticale.
 *
 * La v1 web affiche un vrai <table> avec les cellules fusionnées d'origine ;
 * React Native n'a pas de primitive de tableau, et une grille à 5 colonnes serait
 * illisible sur un téléphone. `buildFlowPhases` résout donc la grille puis la
 * regroupe : les ingrédients qui subissent la même suite d'actions forment une
 * phase. Changement de présentation assumé, pas un contournement.
 */
export default function FlowView({ flowTable }) {
  const { preambule, phases } = buildFlowPhases(flowTable);

  if (phases.length === 0 && preambule.length === 0) return null;

  return (
    <View style={styles.bloc}>
      {preambule.length > 0 ? (
        <View style={styles.preambule}>
          <Text style={styles.titrePreambule}>Avant de commencer</Text>
          {preambule.map((texte, index) => (
            <Text key={index} style={styles.textePreambule}>
              · {texte}
            </Text>
          ))}
        </View>
      ) : null}

      {phases.map((phase, index) => (
        <View key={phase.cle} style={styles.phase}>
          <View style={styles.colonneRepere}>
            <View style={styles.puce}>
              <Text style={styles.numeroPuce}>{index + 1}</Text>
            </View>
            {index < phases.length - 1 ? <View style={styles.trait} /> : null}
          </View>

          <View style={styles.contenuPhase}>
            {phase.elements.length > 0 ? (
              <View style={styles.elements}>
                {phase.elements.map((element, i) => (
                  <Text key={i} style={styles.element}>
                    {element}
                  </Text>
                ))}
              </View>
            ) : null}

            {phase.etapes.map((etape, i) => (
              <View key={i} style={styles.etape}>
                {etape.libelle ? <Text style={styles.libelleEtape}>{etape.libelle}</Text> : null}
                <Text style={styles.texteEtape}>{etape.texte}</Text>
              </View>
            ))}

            {phase.consignes.map((consigne, i) => (
              <Text key={`c${i}`} style={styles.consigne}>
                {consigne}
              </Text>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bloc: { gap: espacements.md },
  preambule: {
    backgroundColor: colors.surfaceCreuse,
    borderRadius: rayons.md,
    padding: espacements.md,
    gap: espacements.xs,
  },
  titrePreambule: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.texteDoux,
  },
  textePreambule: { fontSize: 14, color: colors.texte, lineHeight: 20 },

  phase: { flexDirection: 'row', gap: espacements.md },
  colonneRepere: { alignItems: 'center', width: 26 },
  puce: {
    width: 26,
    height: 26,
    borderRadius: rayons.pilule,
    backgroundColor: colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numeroPuce: { color: colors.blanc, fontSize: 13, fontWeight: '700' },
  trait: { flex: 1, width: 2, backgroundColor: colors.bordureForte, marginTop: espacements.xs },

  contenuPhase: { flex: 1, paddingBottom: espacements.lg, gap: espacements.sm },
  elements: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.bordure,
    borderRadius: rayons.md,
    padding: espacements.md,
    gap: 2,
  },
  element: { fontSize: 14, color: colors.texte },
  etape: { gap: 2 },
  libelleEtape: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.terracotta,
  },
  texteEtape: { fontSize: 15, color: colors.texte, lineHeight: 22 },
  consigne: { fontSize: 14, color: colors.texteDoux, fontStyle: 'italic', lineHeight: 20 },
});
