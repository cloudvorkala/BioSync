package com.biosync

import android.os.Build
import com.facebook.react.bridge.*
import com.samsung.android.sdk.health.data.HealthDataService
import com.samsung.android.sdk.health.data.data.HealthDataPoint
import com.samsung.android.sdk.health.data.error.ErrorCode
import com.samsung.android.sdk.health.data.error.HealthDataException
import com.samsung.android.sdk.health.data.helper.SdkVersion
import com.samsung.android.sdk.health.data.permission.AccessType
import com.samsung.android.sdk.health.data.permission.Permission
import com.samsung.android.sdk.health.data.request.DataType.BloodGlucoseType
import com.samsung.android.sdk.health.data.request.DataTypes
import com.samsung.android.sdk.health.data.request.InstantTimeFilter
import com.samsung.android.sdk.health.data.request.Ordering
import java.time.Instant
import kotlinx.coroutines.*

/** Read-only SDK boundary. No meal policy, integration, or network calls live here. */
class SamsungHealthNativeModule(context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private val permissions = setOf(Permission.of(DataTypes.BLOOD_GLUCOSE, AccessType.READ))
  override fun getName() = "SamsungHealth"

  private fun checkDevice() {
    // Samsung does not support emulator operation; availability on a real phone
    // is decided by the SDK, not by requiring a Samsung manufacturer name.
    if (Build.FINGERPRINT.startsWith("generic") || Build.FINGERPRINT.contains("emulator") ||
        Build.MODEL.contains("Emulator") || Build.MODEL.contains("sdk_gphone")) {
      throw BridgeFailure("SAMSUNG_UNAVAILABLE", "Samsung Health Data SDK requires a physical Android device.")
    }
    check(SdkVersion.getVersionName() == "1.1.0") { "Unexpected Samsung SDK version" }
  }

  @ReactMethod
  fun getAccess(requestPermission: Boolean, promise: Promise) = launch(promise) {
    checkDevice()
    val store = HealthDataService.getStore(reactApplicationContext)
    val granted = if (requestPermission) {
      val activity = reactApplicationContext.currentActivity
          ?: throw BridgeFailure("SAMSUNG_NO_ACTIVITY", "Open BioSync before requesting Samsung Health permission.")
      // Called only following an explicit button press. Never asks for WRITE.
      store.requestPermissions(permissions, activity)
    } else {
      store.getGrantedPermissions(permissions)
    }
    Arguments.createMap().apply {
      putString("availability", "available")
      putString("permission", if (granted.containsAll(permissions)) "granted" else "denied")
    }
  }

  @ReactMethod
  fun readBloodGlucose(startTime: String, endTime: String, promise: Promise) = launch(promise) {
    checkDevice()
    val start = parseUtc(startTime)
    val end = parseUtc(endTime)
    if (!start.isBefore(end)) throw BridgeFailure("SAMSUNG_INVALID_RANGE", "Start must precede end.")
    val store = HealthDataService.getStore(reactApplicationContext)
    if (!store.getGrantedPermissions(permissions).containsAll(permissions)) {
      throw BridgeFailure("SAMSUNG_PERMISSION_DENIED", "Samsung Health blood glucose read permission is not granted.")
    }
    withContext(Dispatchers.IO) {
      val result = Arguments.createArray()
      val seenTokens = mutableSetOf<String>()
      var token: String? = null
      do {
        val builder = DataTypes.BLOOD_GLUCOSE.readDataRequestBuilder
            .setInstantTimeFilter(InstantTimeFilter.of(start, end, true, false))
            .setOrdering(Ordering.ASC)
            .setPageSize(500)
        token?.let { builder.setPageToken(it) }
        val page = store.readData(builder.build())
        page.dataList.forEach { result.pushMap(serialize(it)) }
        token = page.pageToken?.takeIf { it.isNotEmpty() }
        if (token != null && !seenTokens.add(token!!)) {
          throw BridgeFailure("SAMSUNG_READ_ERROR", "Samsung Health returned a repeated page token.")
        }
      } while (token != null)
      result
    }
  }

  private fun parseUtc(value: String): Instant {
    if (!value.endsWith("Z")) throw BridgeFailure("SAMSUNG_INVALID_RANGE", "Use UTC timestamps ending in Z.")
    return try { Instant.parse(value) } catch (_: Exception) {
      throw BridgeFailure("SAMSUNG_INVALID_RANGE", "Use valid UTC timestamps.")
    }
  }

  private fun serialize(point: HealthDataPoint): WritableMap = Arguments.createMap().apply {
    putString("uid", point.uid)
    putString("startTime", point.startTime.toString())
    // Package only, for on-device diagnostics; no device IDs are exported.
    putString("sourcePackage", point.dataSource?.appId)
    val series = point.getValue(BloodGlucoseType.SERIES_DATA)
    if (!series.isNullOrEmpty()) {
      putArray("series", Arguments.createArray().apply {
        series.forEach { sample ->
          pushMap(Arguments.createMap().apply {
            putString("timestamp", sample.timestamp.toString())
            putDouble("glucoseMmolL", sample.glucose.toDouble())
          })
        }
      })
      // GLUCOSE_LEVEL is the series average: never export it as an extra sample.
    } else {
      point.getValue(BloodGlucoseType.GLUCOSE_LEVEL)?.let {
        putDouble("glucoseMmolL", it.toDouble())
      }
    }
  }

  private fun launch(promise: Promise, operation: suspend () -> Any) {
    scope.launch {
      try { promise.resolve(operation()) }
      catch (error: CancellationException) { promise.reject("SAMSUNG_CANCELLED", "Samsung Health operation cancelled.") }
      catch (error: Exception) {
        val failure = when (error) {
          is BridgeFailure -> error
          is HealthDataException -> when (error.errorCode) {
            ErrorCode.ERR_PLATFORM_NOT_INSTALLED, ErrorCode.ERR_PLATFORM_DISABLED ->
                BridgeFailure("SAMSUNG_UNAVAILABLE", "Install or enable Samsung Health on a physical device.")
            ErrorCode.ERR_OLD_VERSION_PLATFORM ->
                BridgeFailure("SAMSUNG_UPDATE_REQUIRED", "Update Samsung Health to 6.30.2 or later.")
            ErrorCode.ERR_PLATFORM_NOT_INITIALIZED ->
                BridgeFailure("SAMSUNG_INITIALIZATION_REQUIRED", "Open Samsung Health and complete its setup first.")
            ErrorCode.ERR_NO_USER_PERMISSION ->
                BridgeFailure("SAMSUNG_PERMISSION_DENIED", "Samsung Health blood glucose read permission is not granted.")
            ErrorCode.ERR_ACCESS_CONTROL, ErrorCode.ERR_INVALID_CALLER,
            ErrorCode.ERR_CHILD_ACCOUNT_ACCESS, ErrorCode.ERR_INVALID_PLATFORM_SIGNATURE ->
                BridgeFailure("SAMSUNG_READ_ACCESS_UNAVAILABLE", "Samsung Health SDK read access is unavailable. For development check Data Read developer mode; distributed apps require registration. Account or platform restrictions may also apply.")
            else -> BridgeFailure("SAMSUNG_READ_ERROR", "Samsung Health could not complete the operation. Check the app and retry.")
          }
          else -> BridgeFailure("SAMSUNG_READ_ERROR", "Samsung Health could not complete the operation. Check the app and retry.")
        }
        // Do not expose/log raw health records or SDK exception details.
        promise.reject(failure.code, failure.message)
      }
    }
  }

  override fun invalidate() {
    scope.cancel()
    super.invalidate()
  }

  private class BridgeFailure(val code: String, message: String) : Exception(message)
}
