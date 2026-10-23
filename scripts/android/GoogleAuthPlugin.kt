package com.chatmin.app

import android.accounts.Account
import android.app.Activity
import androidx.activity.result.ActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.ClearTokenRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope

@InvokeArg
class GoogleAuthorizeArgs {
    var interactive: Boolean = false
    var email: String? = null
    var invalidToken: String? = null
}

/** Authorization only: Play services holds its grants; ChatMin holds no refresh token. */
@TauriPlugin
class GoogleAuthPlugin(private val activity: Activity) : Plugin(activity) {
    companion object {
        // Public Android OAuth client, selected by Play services using package + signer SHA-1.
        const val ANDROID_CLIENT_ID = "1072274940233-euo0umuej2tsbrfq1ir0barhkrolm4cu.apps.googleusercontent.com"
        private val SCOPES = listOf(
            "openid",
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/userinfo.profile",
            "https://www.googleapis.com/auth/chat.spaces.readonly",
            "https://www.googleapis.com/auth/chat.messages",
            "https://www.googleapis.com/auth/chat.memberships.readonly",
            "https://www.googleapis.com/auth/chat.users.readstate",
            "https://www.googleapis.com/auth/directory.readonly"
        )
    }

    private val client by lazy { Identity.getAuthorizationClient(activity) }
    private val pending = mutableMapOf<Long, Invoke>()
    private var interactiveId: Long? = null
    // Tauri owns one activity-result slot. Cancellation resolves Rust immediately,
    // but this lock survives until the launched Google Activity actually returns.
    private var resolutionId: Long? = null

    @Command
    fun authorize(invoke: Invoke) {
        val args = invoke.parseArgs(GoogleAuthorizeArgs::class.java)
        if (!args.interactive && args.email.isNullOrBlank()) {
            invoke.reject("Đăng nhập lại để chọn tài khoản Google", "authorization_required")
            return
        }
        if (args.interactive && (interactiveId != null || resolutionId != null)) {
            invoke.reject("Đang mở đăng nhập Google", "busy")
            return
        }
        pending[invoke.id] = invoke
        if (args.interactive) interactiveId = invoke.id
        val invalid = args.invalidToken
        if (!invalid.isNullOrBlank()) {
            client.clearToken(ClearTokenRequest.builder().setToken(invalid).build())
                .addOnSuccessListener { request(invoke, args) }
                .addOnFailureListener { fail(invoke, it) }
        } else request(invoke, args)
    }

    private fun request(invoke: Invoke, args: GoogleAuthorizeArgs) {
        if (!pending.containsKey(invoke.id)) return
        val builder = AuthorizationRequest.builder().setRequestedScopes(SCOPES.map { Scope(it) })
        if (args.interactive) builder.setPrompt(AuthorizationRequest.Prompt.SELECT_ACCOUNT)
        else builder.setAccount(Account(args.email!!, "com.google"))
        client.authorize(builder.build())
            .addOnSuccessListener { result ->
                if (!pending.containsKey(invoke.id)) return@addOnSuccessListener
                if (result.hasResolution()) {
                    if (!args.interactive) {
                        reject(invoke, "Google cần xác nhận quyền truy cập. Đăng nhập lại để tiếp tục.", "authorization_required")
                    } else {
                        val intent = result.pendingIntent
                        if (intent == null) reject(invoke, "Google không trả yêu cầu xác nhận", "authorization_required")
                        else {
                            try {
                                resolutionId = invoke.id
                                startIntentSenderForResult(invoke, IntentSenderRequest.Builder(intent.intentSender).build(), "authorizationResult")
                            } catch (e: Exception) {
                                resolutionId = null
                                fail(invoke, e)
                            }
                        }
                    }
                } else resolve(invoke, result)
            }
            .addOnFailureListener { fail(invoke, it) }
    }

    @ActivityCallback
    private fun authorizationResult(invoke: Invoke, result: ActivityResult) {
        if (resolutionId != invoke.id) return
        resolutionId = null
        // A cancelled invoke has already rejected; never accept its late result.
        if (!pending.containsKey(invoke.id)) return
        if (result.resultCode != Activity.RESULT_OK) {
            reject(invoke, "cancelled", "cancelled")
            return
        }
        try {
            resolve(invoke, client.getAuthorizationResultFromIntent(result.data))
        } catch (e: Exception) { fail(invoke, e) }
    }

    private fun resolve(invoke: Invoke, result: AuthorizationResult) {
        if (!pending.containsKey(invoke.id)) return
        val token = result.accessToken
        val granted = result.grantedScopes.toSet()
        if (token.isNullOrBlank() || !granted.containsAll(SCOPES.filter { it.contains("/auth/chat.") || it.endsWith("/auth/directory.readonly") })) {
            reject(invoke, "Chưa cấp đủ quyền Google Chat. Vui lòng đăng nhập lại và chấp nhận các quyền cần thiết.", "authorization_required")
            return
        }
        finish(invoke)
        invoke.resolve(JSObject().put("accessToken", token))
    }

    private fun finish(invoke: Invoke) {
        pending.remove(invoke.id)
        if (interactiveId == invoke.id) interactiveId = null
    }

    private fun reject(invoke: Invoke, message: String, code: String) {
        if (!pending.containsKey(invoke.id)) return
        finish(invoke)
        invoke.reject(message, code)
    }

    private fun fail(invoke: Invoke, error: Exception) {
        val status = (error as? ApiException)?.statusCode
        when (status) {
            7 -> reject(invoke, "Không kết nối được Google. Kiểm tra mạng rồi thử lại.", "offline")
            16, 12501 -> reject(invoke, "cancelled", "cancelled")
            4, 6 -> reject(invoke, "Google cần đăng nhập hoặc xác nhận quyền truy cập.", "authorization_required")
            10 -> reject(invoke, "OAuth Android chưa khớp package hoặc SHA-1 của bản cài. Kiểm tra Google Cloud client.", "configuration")
            else -> reject(invoke, "Google không thể cấp quyền (mã ${status ?: "unknown"}). Thử lại hoặc kiểm tra Google Play services.", "google_error")
        }
    }

    @Command
    fun invalidate(invoke: Invoke) {
        val token = invoke.getArgs().getString("token")
        if (token.isBlank()) {
            invoke.resolve()
            return
        }
        client.clearToken(ClearTokenRequest.builder().setToken(token).build())
            .addOnSuccessListener { invoke.resolve() }
            .addOnFailureListener { invoke.reject("Không thể làm mới bộ nhớ token Google", "google_error") }
    }

    @Command
    fun cancel(invoke: Invoke) {
        interactiveId?.let { pending[it] }?.let { reject(it, "cancelled", "cancelled") }
        invoke.resolve()
    }

    override fun onDestroy(activity: AppCompatActivity) {
        pending.values.toList().forEach { reject(it, "cancelled", "cancelled") }
        resolutionId = null
    }
}
