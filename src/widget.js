import { Capacitor, registerPlugin } from '@capacitor/core';

const EnmaWidget = registerPlugin('EnmaWidget');

export function isNativeAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function updateAndroidWidget(summary) {
  if (!isNativeAndroid()) return;
  try {
    await EnmaWidget.update(summary);
  } catch (error) {
    console.warn('No se pudo actualizar el widget', error);
  }
}

export async function requestPinAndroidWidget() {
  if (!isNativeAndroid()) return { supported: false };
  return EnmaWidget.requestPin();
}
