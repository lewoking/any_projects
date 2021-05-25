; this Script works on Windows 10 system.
; You can Click key, F1 to EXIT

#SingleInstance, force

run notepad.exe z:\example.csv
WinWaitActive,example.csv, , 2



loop
{

InputBox,Clipboard,Search for Name
sleep 100
send ^{Home} ;goto Top of the Page
sleep 100
send ^f ;goto the Find box 
sleep 100
send ^v ;paste Clipboard Value
sleep 100
send {enter}
sleep 1500 ;You can change this sleep codeline - How bigger the search, how larger the sleep must be.
send {esc}
sleep 100

;If you want to Select the Whole Search Line - you can use this code.
;send {Home}
;sleep 100
;send +{End}

;If you want to Select the Rigth Site of the Line - you can use this code. 
send {Right}
sleep 100
send +{End}

sleep 100
send ^c ;copy the Search LineValue to Clipboard 
LineValue = %Clipboard%
sleep 100
word_array := StrSplit(LineValue, ",")
sleep 100
SearchValue := word_array[1]" "       ;word_array[2]" "word_array[3]
sleep 100
MsgBox "SearchValue",%SearchValue%
}

F1::ExitApp