package app.apexghost.racing;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * APEX GHOST: the game runs in Capacitor's WebView. This activity only makes it a proper racing game window:
 * full screen (immersive, bars come back with a swipe), drawn under the notch (the page keeps clear of it with
 * CSS safe-area insets), screen kept on while the app is open, and sound allowed without an extra tap.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // the game's own native piece: 90/120/144 Hz display modes (Settings → Frame rate)
        registerPlugin(RefreshRatePlugin.class);
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = window.getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(lp);
        }
        WindowCompat.setDecorFitsSystemWindows(window, false);
        hideSystemBars();
        if (getBridge() != null) {
            WebView web = getBridge().getWebView();
            WebSettings s = web.getSettings();
            s.setMediaPlaybackRequiresUserGesture(false);
            web.setOverScrollMode(View.OVER_SCROLL_NEVER);
            web.setHapticFeedbackEnabled(false);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    private void hideSystemBars() {
        Window window = getWindow();
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(window, window.getDecorView());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        c.hide(WindowInsetsCompat.Type.systemBars());
    }
}
