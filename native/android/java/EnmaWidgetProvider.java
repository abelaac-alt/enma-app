package com.enma.cycle;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

public class EnmaWidgetProvider extends AppWidgetProvider {
    public static final String PREFS = "enma_widget";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateOne(context, appWidgetManager, appWidgetId);
        }
    }

    public static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName component = new ComponentName(context, EnmaWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(component);
        for (int id : ids) updateOne(context, manager, id);
    }

    private static void updateOne(Context context, AppWidgetManager manager, int widgetId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String personName = prefs.getString("personName", "Enma");
        String days = prefs.getString("daysRemaining", "—");
        String nextDate = prefs.getString("nextDate", "Sin datos");
        String status = prefs.getString("status", "Abre Enma para actualizar");

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.enma_widget);
        views.setTextViewText(R.id.enma_widget_person, personName);
        views.setTextViewText(R.id.enma_widget_days, days);
        views.setTextViewText(R.id.enma_widget_label, "días");
        views.setTextViewText(R.id.enma_widget_date, nextDate);
        views.setTextViewText(R.id.enma_widget_status, status);

        Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launchIntent != null) {
            launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                    context,
                    101,
                    launchIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            views.setOnClickPendingIntent(R.id.enma_widget_root, pendingIntent);
        }

        manager.updateAppWidget(widgetId, views);
    }
}
