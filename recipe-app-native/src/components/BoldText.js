import { Text } from 'react-native';

import { splitBold } from '../utils/format';

/**
 * Affiche un texte pouvant contenir des passages « **en gras** », sans passer par
 * une dépendance Markdown. Aucune des 17 recettes actuelles n'utilise cette
 * syntaxe : le composant se comporte alors comme un simple <Text>.
 */
export default function BoldText({ children, style, boldStyle, ...reste }) {
  const segments = splitBold(typeof children === 'string' ? children : '');

  if (segments.length <= 1) {
    return (
      <Text style={style} {...reste}>
        {children}
      </Text>
    );
  }

  return (
    <Text style={style} {...reste}>
      {segments.map((segment, index) => (
        <Text key={index} style={segment.gras ? [{ fontWeight: '700' }, boldStyle] : null}>
          {segment.texte}
        </Text>
      ))}
    </Text>
  );
}
