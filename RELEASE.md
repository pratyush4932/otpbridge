# OTP Bridge — Android Release & Build Guide

This document provides instructions for compiling, signing, packaging, and installing the **OTP Bridge** Android application (`com.otpbridge.app`).

---

## 1. Prerequisites

Ensure your development environment meets the following requirements:

- **Node.js**: `v18.x` or `v20.x` LTS
- **Java Development Kit (JDK)**: JDK 17 (e.g. OpenJDK 17 or Temurin 17)
  ```bash
  java -version
  ```
- **Android SDK**:
  - `compileSdkVersion`: 35
  - `targetSdkVersion`: 35
  - `minSdkVersion`: 24 (Android 7.0+)
  - Android Build Tools: `35.0.0`
  - Android NDK: `27.1.12297006` (or compatible NDK configured with CMake)
  - Environment variables configured:
    - `ANDROID_HOME`: e.g. `C:\Users\<user>\AppData\Local\Android\Sdk`
    - `JAVA_HOME`: e.g. `C:\Program Files\Eclipse Adoptium\jdk-17.0.x`
    - `PATH` includes `%ANDROID_HOME%\platform-tools` and `%ANDROID_HOME%\cmdline-tools\latest\bin`

---

## 2. Project Architecture & Branding Assets

OTP Bridge mobile client uses:
- **App Name**: `OTP Bridge`
- **Package Name**: `com.otpbridge.app`
- **Application Icon**: `mobile/assets/otpb_icon.png` (mapped to `res/mipmap-*/ic_launcher.png`, `ic_launcher_round.png`, `ic_launcher_foreground.png` with background `#0254E3`).
- **Splash Screen**: `mobile/assets/otp_logo.png` with rounded squircle corners (mapped to `res/drawable-*/splashscreen_logo.png` with background `#FFFFFF`).
- **In-App Headers**: `otp_logo.png` with rounded corners positioned directly before the `OTP Bridge` title.

---

## 3. Building the APK

Open a terminal and navigate to the `mobile/android` directory:

```bash
cd mobile/android
```

### Option A: Assemble Debug APK (Recommended for Testing & Sideloading)

The debug build is pre-configured with Android's default debug keystore, allowing immediate compilation and installation without custom certificates:

```bash
# On Windows PowerShell
.\gradlew assembleDebug

# On macOS / Linux
./gradlew assembleDebug
```

**Output APK Location**:
```
mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

---

### Option B: Assemble Release APK (Production)

#### Step 1: Generate a Production Keystore (One-time)
If you do not already have an upload keystore, generate one using `keytool`:

```bash
keytool -genkeypair -v -storetype PKCS12 -keystore otpbridge-release-key.keystore -alias otpbridge-alias -keyalg RSA -keysize 2048 -validity 10000
```
Keep this keystore file and passwords secure. Place `otpbridge-release-key.keystore` inside `mobile/android/app/`.

#### Step 2: Configure Gradle Keystore Properties
Create or edit `mobile/android/gradle.properties` (or user-level `~/.gradle/gradle.properties`) to avoid checking passwords into version control:

```properties
OTPBRIDGE_RELEASE_STORE_FILE=otpbridge-release-key.keystore
OTPBRIDGE_RELEASE_KEY_ALIAS=otpbridge-alias
OTPBRIDGE_RELEASE_STORE_PASSWORD=your_keystore_password
OTPBRIDGE_RELEASE_KEY_PASSWORD=your_key_password
```

#### Step 3: Verify `build.gradle` Signing Configuration
In `mobile/android/app/build.gradle`:

```groovy
android {
    ...
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            if (project.hasProperty('OTPBRIDGE_RELEASE_STORE_FILE')) {
                storeFile file(OTPBRIDGE_RELEASE_STORE_FILE)
                storePassword OTPBRIDGE_RELEASE_STORE_PASSWORD
                keyAlias OTPBRIDGE_RELEASE_KEY_ALIAS
                keyPassword OTPBRIDGE_RELEASE_KEY_PASSWORD
            } else {
                signingConfig signingConfigs.debug
            }
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
            shrinkResources false
        }
    }
}
```

#### Step 4: Run the Release Build
```bash
# Clean previous artifacts
.\gradlew clean

# Build release APK
.\gradlew assembleRelease
```

**Output APK Location**:
```
mobile/android/app/build/outputs/apk/release/app-release.apk
```

---

## 4. Installing the APK on a Device

### Connect Via USB or Wi-Fi ADB
Ensure USB debugging is enabled on your Android device:

```bash
adb devices
```
*Expected output:*
```
List of devices attached
ZD222SHBHB    device
```

### Install with Runtime Permissions Pre-granted (`-g`)

```bash
# For Debug APK:
adb install -r -g mobile/android/app/build/outputs/apk/debug/app-debug.apk

# For Release APK:
adb install -r -g mobile/android/app/build/outputs/apk/release/app-release.apk
```

*Flags explained:*
- `-r`: Reinstall existing app, preserving app data.
- `-g`: Grant all runtime permissions declared in the manifest automatically upon install.

---

## 5. Post-Installation Device Setup

### A. Sender Device (Phone Reading SMS / OTPs)
1. Launch **OTP Bridge** on the Sender phone.
2. Select **Sender Mode**.
3. **Grant Notification Access**:
   - Go to Android **Settings** → **Apps** → **Special app access** → **Notification access**.
   - Find **OTP Bridge** and toggle to **Allow**.
   - *(Note: On Android 13+, if "Restricted setting" dialog appears: Go to Settings → Apps → OTP Bridge → tap the 3-dots menu top right → tap "Allow restricted settings", then re-enable Notification access).*
4. **Battery Optimization**:
   - Go to **Settings** → **Apps** → **OTP Bridge** → **Battery** → Select **Unrestricted** to prevent the background notification listener from being killed by the OS.
5. Tap **Scan Pairing QR Code** to pair with the Receiver.

### B. Receiver Device (Phone or Dashboard Receiving OTPs)
1. Launch **OTP Bridge** on the Receiver device.
2. Select **Receiver Mode**.
3. Tap **Pair New Device** to display the QR Code.
4. Once scanned by the Sender, the devices will establish an encrypted, real-time WebSocket connection to forward OTPs instantly.

---

## 6. Permissions Reference

The app uses the following permissions declared in `mobile/android/app/src/main/AndroidManifest.xml`:

| Permission | Purpose |
| :--- | :--- |
| `android.permission.INTERNET` | Communication with the backend socket server |
| `android.permission.ACCESS_NETWORK_STATE` | Network connectivity and carrier detection |
| `android.permission.BIND_NOTIFICATION_LISTENER_SERVICE` | Real-time OTP extraction from incoming notifications |
| `android.permission.CAMERA` | Scanning QR codes during device pairing |
| `android.permission.FOREGROUND_SERVICE` | Continuous background bridge service |
| `android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE` | Persistent device connection tracking |
| `android.permission.POST_NOTIFICATIONS` | Status notifications and service updates (Android 13+) |

---

## 7. Troubleshooting Build Issues

- **Windows Ninja CMake Paths**:
  If building release encounters Ninja directory creation errors for React Native native dependencies, ensure `mobile/android/build.gradle` includes the pre-creation directory hook or build using the debug variant.
- **Port Conflict**:
  If Metro or backend conflicts occur, kill remaining node processes:
  ```powershell
  Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
  ```
- **Clean Gradle Cache**:
  ```bash
  cd mobile/android
  .\gradlew clean
  rmdir /s /q app\build
  ```
