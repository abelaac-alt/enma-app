package com.enma.cycle;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "EnmaWidget")
public class EnmaWidgetPlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        Context context = getContext();
        context.getSharedPreferences(EnmaWidgetProvider.PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString("personName", value(call.getString("personName"), "Enma"))
                .putString("daysRemaining", value(call.getString("daysRemaining"), "—"))
                .putString("nextDate", value(call.getString("nextDate"), "Sin datos"))
                .putString("status", value(call.getString("status"), ""))
                .apply();
        EnmaWidgetProvider.updateAll(context);
        call.resolve();
    }

    @PluginMethod
    public void requestPin(PluginCall call) {
        JSObject result = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            result.put("supported", false);
            result.put("requested", false);
            call.resolve(result);
            return;
        }

        AppWidgetManager manager = AppWidgetManager.getInstance(getContext());
        boolean supported = manager.isRequestPinAppWidgetSupported();
        boolean requested = false;
        if (supported) {
            ComponentName provider = new ComponentName(getContext(), EnmaWidgetProvider.class);
            requested = manager.requestPinAppWidget(provider, null, null);
        }
        result.put("supported", supported);
        result.put("requested", requested);
        call.resolve(result);
    }

    private String value(String input, String fallback) {
        return input == null ? fallback : input;
    }
}
