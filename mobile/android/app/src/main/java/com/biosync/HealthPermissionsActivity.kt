package com.biosync

import android.app.Activity
import android.os.Bundle
import android.widget.ScrollView
import android.widget.TextView

/** Local rationale used by Health Connect on both Android 13 and Android 14+. */
class HealthPermissionsActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val text = TextView(this).apply {
      text = getString(R.string.health_connect_rationale)
      textSize = 18f
      val padding = (24 * resources.displayMetrics.density).toInt()
      setPadding(padding, padding, padding, padding)
    }
    setContentView(ScrollView(this).apply { addView(text) })
  }
}
