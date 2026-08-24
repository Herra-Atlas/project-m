#NoEnv
#SingleInstance, Force
#Persistent
SetBatchLines, -1

Gui, +HwndhWnd +ToolWindow -Caption
Gui, Show, Hide, AHK_IPC
TrayTip, IPC, ipc_listener started (AHK_IPC), 2, 1

OnMessage(0x4A, "ReceiveCopyData")
return

ReceiveCopyData(wParam, lParam, msg, hwnd)
{
    Critical
    strPtr := NumGet(lParam + (A_PtrSize * 2), "Ptr")
    strLen := NumGet(lParam + A_PtrSize, "UInt")
    if (strPtr && strLen)
    {
        text := StrGet(strPtr, strLen / 2, "UTF-16")
        TrayTip, IPC, recv '%text%', 1, 1
        if (text = "E")
        {
            SendInput {e down}
            Sleep 30
            SendInput {e up}
        }
        else if (text = "G")
        {
            SendInput {g down}
            Sleep 30
            SendInput {g up}
        }
        else if (text = "3")
        {
            SendInput {3 down}
            Sleep 30
            SendInput {3 up}
        }
        else if (text = "SPACE_HOLD")
        {
            SendInput {Space down}
            Sleep 2000
            SendInput {Space up}
        }
        else if (text != "")
        {
            SendInput %text%
        }
    }
    return 1
}
