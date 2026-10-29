# Backup fixtures

Backups made by each app's E2E build, for the restore tests on the other
platforms. Each file is the object the app uploaded to its backup destination.
The vault in it opens with the password `CrossPlatformFixture42` and holds a
login named after the app that made it:

| File             | Made by       | Login                     |
| ---------------- | ------------- | ------------------------- |
| `web.cryx`       | Web app       | `Web Fixture Login`       |
| `extension.cryx` | Extension     | `Extension Fixture Login` |
| `android.cryx`   | Android app   | `Android Fixture Login`   |

Keep them as they are: every release must still restore backups that earlier
versions made. To cover a newer format, add a file instead of replacing one.
