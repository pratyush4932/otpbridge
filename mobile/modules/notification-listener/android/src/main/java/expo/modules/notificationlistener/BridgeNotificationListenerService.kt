package expo.modules.notificationlistener

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.util.UUID

class BridgeNotificationListenerService : NotificationListenerService() {

    override fun onListenerConnected() {
        super.onListenerConnected()
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return

        val pkgName = sbn.packageName ?: return

        // Ignore notifications posted by OTP Bridge itself to avoid feedback loops
        if (pkgName == applicationContext.packageName) {
            return
        }

        val notification = sbn.notification ?: return
        val extras = notification.extras ?: return

        // Extract visible title & text safely
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
        val subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()

        val fullBody = when {
            !bigText.isNullOrBlank() -> bigText
            !text.isNullOrBlank() -> text
            !subText.isNullOrBlank() -> subText
            else -> {
                // Support multi-line InboxStyle notifications
                val lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
                if (lines != null && lines.isNotEmpty()) {
                    lines.filterNotNull().joinToString(" ")
                } else {
                    // Support MessagingStyle notifications (Google Messages, WhatsApp)
                    val messages = extras.getParcelableArray(Notification.EXTRA_MESSAGES)
                    if (messages != null && messages.isNotEmpty()) {
                        val lastMsg = messages.lastOrNull()
                        if (lastMsg is android.os.Bundle) {
                            lastMsg.getCharSequence("text")?.toString()
                        } else null
                    } else null
                }
            }
        }

        // Ignore empty, redacted, or inaccessible notification content
        if (fullBody.isNullOrBlank()) {
            return
        }

        // Avoid logging body or sensitive OTP in system logcat
        // Generate stable event ID combining key and timestamp
        val stableId = "${sbn.key}_${sbn.postTime}"

        val payload = NotificationPayload(
            id = stableId,
            packageName = pkgName,
            title = title,
            text = fullBody,
            timestamp = sbn.postTime,
            isSynthetic = false
        )

        NotificationEventBus.emit(payload)
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        // Notification removal is ignored
    }

    companion object {
        /**
         * Checks whether the user has granted notification listener permission to this app.
         */
        fun isPermissionGranted(context: Context): Boolean {
            val packageName = context.packageName
            val flat = Settings.Secure.getString(
                context.contentResolver,
                "enabled_notification_listeners"
            ) ?: return false

            val names = flat.split(":")
            for (name in names) {
                val cn = ComponentName.unflattenFromString(name)
                if (cn != null && cn.packageName == packageName) {
                    return true
                }
            }
            return false
        }

        /**
         * Opens the Android system settings page for Notification Listener access.
         */
        fun openSettings(context: Context) {
            val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        }

        /**
         * Native synthetic test pathway to inject notifications for testing without real OTPs.
         */
        fun simulateNotification(packageName: String, title: String?, text: String?): Boolean {
            if (text.isNullOrBlank()) return false

            val syntheticId = "syn_${UUID.randomUUID()}"
            val payload = NotificationPayload(
                id = syntheticId,
                packageName = packageName,
                title = title,
                text = text,
                timestamp = System.currentTimeMillis(),
                isSynthetic = true
            )
            NotificationEventBus.emit(payload)
            return true
        }
    }
}
