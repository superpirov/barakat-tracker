package com.superpirov.barakat;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity implements SensorEventListener {

    private SensorManager sensorManager;
    private Sensor rotationVector;
    private final float[] rotationMatrix = new float[9];
    private final float[] orientationAngles = new float[3];
    private volatile float heading = -1f;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
            if (sensorManager != null) {
                rotationVector = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
            }
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                webView.addJavascriptInterface(new CompassBridge(), "AndroidCompass");
            }
        } catch (Exception e) {
            // компас не критичен для работы приложения
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        if (sensorManager != null && rotationVector != null) {
            sensorManager.registerListener(this, rotationVector, SensorManager.SENSOR_DELAY_GAME);
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        if (sensorManager != null) {
            sensorManager.unregisterListener(this);
        }
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event.sensor.getType() == Sensor.TYPE_ROTATION_VECTOR) {
            SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values);
            SensorManager.getOrientation(rotationMatrix, orientationAngles);
            float azimuth = (float) Math.toDegrees(orientationAngles[0]);
            heading = (azimuth + 360f) % 360f;
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
    }

    public class CompassBridge {
        @JavascriptInterface
        public float getHeading() {
            return heading;
        }

        @JavascriptInterface
        public boolean isAvailable() {
            return rotationVector != null;
        }
    }
}
