package expo.modules.notificationlistener

import java.util.concurrent.CopyOnWriteArraySet

data class NotificationPayload(
    val id: String,
    val packageName: String,
    val title: String?,
    val text: String?,
    val timestamp: Long,
    val isSynthetic: Boolean = false
)

object NotificationEventBus {
    private val listeners = CopyOnWriteArraySet<(NotificationPayload) -> Unit>()

    fun subscribe(listener: (NotificationPayload) -> Unit) {
        listeners.add(listener)
    }

    fun unsubscribe(listener: (NotificationPayload) -> Unit) {
        listeners.remove(listener)
    }

    fun emit(payload: NotificationPayload) {
        for (listener in listeners) {
            try {
                listener(payload)
            } catch (e: Exception) {
                // Prevent listener errors from breaking dispatch loop
            }
        }
    }
}
