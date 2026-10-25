package expo.modules.notificationlistener

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Telephony
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NotificationListenerModule : Module() {

    private val context: Context
        get() = appContext.reactContext ?: throw IllegalStateException("React application context is null")

    private val busListener: (NotificationPayload) -> Unit = { payload ->
        try {
            sendEvent(
                "onNotificationReceived",
                mapOf(
                    "id" to payload.id,
                    "packageName" to payload.packageName,
                    "title" to (payload.title ?: ""),
                    "text" to (payload.text ?: ""),
                    "timestamp" to payload.timestamp,
                    "isSynthetic" to payload.isSynthetic
                )
            )
        } catch (e: Exception) {
            // Context might be reloading/invalidated
        }
    }

    override fun definition() = ModuleDefinition {
        Name("NotificationListener")

        Events("onNotificationReceived")

        OnCreate {
            NotificationEventBus.subscribe(busListener)
        }

        OnDestroy {
            NotificationEventBus.unsubscribe(busListener)
        }

        AsyncFunction("isPermissionGranted") {
            BridgeNotificationListenerService.isPermissionGranted(context)
        }

        AsyncFunction("openSettings") {
            BridgeNotificationListenerService.openSettings(context)
        }

        AsyncFunction("simulateNotification") { packageName: String, title: String?, text: String? ->
            BridgeNotificationListenerService.simulateNotification(packageName, title, text)
        }

        AsyncFunction("getDefaultSmsPackage") {
            try {
                Telephony.Sms.getDefaultSmsPackage(context)
            } catch (e: Exception) {
                null
            }
        }

        AsyncFunction("getInstalledSmsApplications") {
            val pm = context.packageManager
            val defaultPkg = try {
                Telephony.Sms.getDefaultSmsPackage(context)
            } catch (e: Exception) {
                null
            }

            val packageMap = mutableMapOf<String, MutableMap<String, Any>>()

            // 1. Query activities responding to smsto: schema
            try {
                val smsIntent = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:"))
                val activities = pm.queryIntentActivities(smsIntent, PackageManager.MATCH_DEFAULT_ONLY)
                for (resolveInfo in activities) {
                    val activityInfo = resolveInfo.activityInfo ?: continue
                    val pkg = activityInfo.packageName ?: continue
                    val isSystem = (activityInfo.applicationInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0
                    val appName = pm.getApplicationLabel(activityInfo.applicationInfo).toString()
                    packageMap[pkg] = mutableMapOf(
                        "packageName" to pkg,
                        "appName" to appName,
                        "isDefault" to (pkg == defaultPkg),
                        "isSystemApp" to isSystem
                    )
                }
            } catch (e: Exception) {
                // Ignore query failures
            }

            // 2. Query broadcast receivers responding to SMS_DELIVER (standard SMS candidates)
            try {
                val deliverIntent = Intent(Telephony.Sms.Intents.SMS_DELIVER_ACTION)
                val deliverReceivers = pm.queryBroadcastReceivers(deliverIntent, 0)
                for (resolveInfo in deliverReceivers) {
                    val receiverInfo = resolveInfo.activityInfo ?: continue
                    val pkg = receiverInfo.packageName ?: continue
                    if (!packageMap.containsKey(pkg)) {
                        val isSystem = (receiverInfo.applicationInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0
                        val appName = pm.getApplicationLabel(receiverInfo.applicationInfo).toString()
                        packageMap[pkg] = mutableMapOf(
                            "packageName" to pkg,
                            "appName" to appName,
                            "isDefault" to (pkg == defaultPkg),
                            "isSystemApp" to isSystem
                        )
                    }
                }
            } catch (e: Exception) {
                // Ignore query failures
            }

            // 3. Ensure the default SMS package is in the map even if not resolved above
            if (!defaultPkg.isNullOrBlank() && !packageMap.containsKey(defaultPkg)) {
                try {
                    val appInfo = pm.getApplicationInfo(defaultPkg, 0)
                    val appName = pm.getApplicationLabel(appInfo).toString()
                    val isSystem = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0
                    packageMap[defaultPkg] = mutableMapOf(
                        "packageName" to defaultPkg,
                        "appName" to appName,
                        "isDefault" to true,
                        "isSystemApp" to isSystem
                    )
                } catch (e: Exception) {
                    packageMap[defaultPkg] = mutableMapOf(
                        "packageName" to defaultPkg,
                        "appName" to "Default Messages",
                        "isDefault" to true,
                        "isSystemApp" to true
                    )
                }
            }

            packageMap.values.toList().sortedBy { (it["appName"] as String).lowercase() }
        }

        AsyncFunction("isPackageInstalled") { packageName: String ->
            try {
                context.packageManager.getPackageInfo(packageName, 0)
                true
            } catch (e: Exception) {
                false
            }
        }

        AsyncFunction("getInstalledApplications") {
            val pm = context.packageManager
            val packages = pm.getInstalledApplications(PackageManager.GET_META_DATA)
            val result = mutableListOf<Map<String, Any>>()

            for (appInfo in packages) {
                // Filter out non-launchable system internals to keep list relevant
                val isSystem = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0
                val launchIntent = pm.getLaunchIntentForPackage(appInfo.packageName)

                // Only include user apps or launchable system apps (e.g., Messages, Phone, Gmail)
                if (!isSystem || launchIntent != null) {
                    val appName = pm.getApplicationLabel(appInfo).toString()
                    result.add(
                        mapOf(
                            "packageName" to appInfo.packageName,
                            "appName" to appName,
                            "isSystemApp" to isSystem
                        )
                    )
                }
            }

            result.sortedBy { (it["appName"] as String).lowercase() }
        }
    }
}
