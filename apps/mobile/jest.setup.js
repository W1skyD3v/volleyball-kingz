// expo-location default: permission granted, fix at Pershing Square (demo court c1). Tests override per case.
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 34.0488, longitude: -118.2518, accuracy: 10 } })),
  Accuracy: { Balanced: 3, High: 4 },
}));

// expo-router: screens only need navigation helpers; effects run on mount.
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams = {};
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    router: mockRouter,
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (cb) => React.useEffect(cb, [cb]),
    __setParams: (p) => {
      mockParams = p;
    },
    __router: mockRouter,
  };
});
