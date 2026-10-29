package app.apexghost.racing;

import android.os.Build;
import android.view.Display;
import android.view.Window;
import android.view.WindowManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.TreeSet;

/**
 * Display refresh rate for the game (Settings → Frame rate): the WebView renders at the window's display mode, which
 * Android leaves at 60 Hz on many 90/120/144 Hz phones. getRates lists the rates the screen offers at its current
 * resolution; setRate picks the fastest mode at or below the requested rate (60 gives the battery-friendly mode back).
 */
@CapacitorPlugin(name = "RefreshRate")
public class RefreshRatePlugin extends Plugin {
    private Display display() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? getActivity().getDisplay() : getActivity().getWindowManager().getDefaultDisplay();
    }

    private static boolean sameSize(Display.Mode a, Display.Mode b) {
        return a.getPhysicalWidth() == b.getPhysicalWidth() && a.getPhysicalHeight() == b.getPhysicalHeight();
    }

    @PluginMethod
    public void getRates(PluginCall call) {
        Display d = display();
        Display.Mode cur = d.getMode();
        TreeSet<Integer> rates = new TreeSet<>();
        for (Display.Mode m : d.getSupportedModes()) if (sameSize(m, cur)) rates.add(Math.round(m.getRefreshRate()));
        JSObject r = new JSObject();
        r.put("rates", new JSArray(rates));
        r.put("current", Math.round(cur.getRefreshRate()));
        call.resolve(r);
    }

    @PluginMethod
    public void setRate(PluginCall call) {
        final int hz = call.getInt("hz", 60);
        getActivity().runOnUiThread(() -> {
            Display d = display();
            Display.Mode cur = d.getMode();
            Display.Mode best = null;
            for (Display.Mode m : d.getSupportedModes()) {
                if (!sameSize(m, cur) || m.getRefreshRate() > hz + 1) continue;
                if (best == null || m.getRefreshRate() > best.getRefreshRate()) best = m;
            }
            Window w = getActivity().getWindow();
            WindowManager.LayoutParams lp = w.getAttributes();
            if (best != null) {
                lp.preferredDisplayModeId = best.getModeId();
                lp.preferredRefreshRate = best.getRefreshRate();
                w.setAttributes(lp);
            }
            JSObject r = new JSObject();
            r.put("hz", best != null ? Math.round(best.getRefreshRate()) : Math.round(cur.getRefreshRate()));
            call.resolve(r);
        });
    }
}
