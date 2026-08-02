import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import {
  NavigationContainer,
  getPathFromState as getPathFromStateParDefaut,
  getStateFromPath as getStateFromPathParDefaut,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import HomeScreen from './src/screens/HomeScreen';
import RecipeDetailScreen from './src/screens/RecipeDetailScreen';
import ShoppingListScreen from './src/screens/ShoppingListScreen';
import { colors } from './src/theme/colors';
import { basePath } from './src/config/base-path.json';
import { addBasePath, stripBasePath } from './src/utils/linking';

const Stack = createNativeStackNavigator();

// Le sous-chemin ne concerne que la version web ; sur mobile, les URL viennent
// d'un schéma applicatif et n'ont pas de préfixe de déploiement.
const prefixe = Platform.OS === 'web' ? basePath : '';

// Rend les écrans adressables par URL sur la version web : /recette/<id> et
// /liste-de-courses, en écho au routage par ancre de la v1. Les deux adaptateurs
// ci-dessous retirent puis remettent le sous-chemin autour du routeur.
const liaison = {
  prefixes: [],
  config: {
    screens: {
      Accueil: '',
      Recette: 'recette/:id',
      ListeDeCourses: 'liste-de-courses',
    },
  },
  getStateFromPath: (chemin, options) =>
    getStateFromPathParDefaut(stripBasePath(chemin, prefixe), options),
  getPathFromState: (etat, options) =>
    addBasePath(getPathFromStateParDefaut(etat, options), prefixe),
};

const optionsCommunes = {
  headerStyle: { backgroundColor: colors.fond },
  headerTitleStyle: { color: colors.texte, fontWeight: '700' },
  headerTintColor: colors.terracotta,
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.fond },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer linking={liaison}>
        <StatusBar style="dark" />
        <Stack.Navigator initialRouteName="Accueil" screenOptions={optionsCommunes}>
          <Stack.Screen name="Accueil" component={HomeScreen} options={{ title: 'Mon carnet de recettes' }} />
          <Stack.Screen name="Recette" component={RecipeDetailScreen} options={{ title: 'Recette' }} />
          <Stack.Screen
            name="ListeDeCourses"
            component={ShoppingListScreen}
            options={{ title: 'Liste de courses' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
