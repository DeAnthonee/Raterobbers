package com.deanthonee.eyespy.minigame.turncalculator

import com.deanthonee.eyespy.minigame.diceroll.DiceRoller
import com.deanthonee.eyespy.minigame.models.Player
import com.deanthonee.eyespy.minigame.models.TurnResults
import com.deanthonee.eyespy.minigame.models.addMoney

class TurnCalculatorImpl(val diceRoller: DiceRoller) : TurnCalculator {
    override var turnNumber: Int = 0

    var playerOne: Player? = null
    var playerTwo: Player? = null
    var playerThree: Player? = null
    var pot = 0

    override fun processTurn(playerList: Triple<Player, Player, Player>): TurnResults {
        pot = 0
        turnNumber += 1

        playerOne = playerList.first
        playerTwo = playerList.second
        playerThree = playerList.third

        val diceAmount = diceRoller.rollDice(playerList.first.pouch)

        val moneyMoveList = ArrayList<MoneyDirection>()

        diceAmount.forEach { roll ->
            when (roll) {
                LEFT -> moneyMoveList.add(MoneyDirection.LEFT)
                CENTER -> moneyMoveList.add(MoneyDirection.CENTER)
                RIGHT -> moneyMoveList.add(MoneyDirection.RIGHT)
                else -> moneyMoveList.add(MoneyDirection.STAY)
            }
        }

        moneyMoveList.forEach { moneyDirection ->
            when (moneyDirection) {
                MoneyDirection.LEFT -> giveToSecondPlayer()
                MoneyDirection.RIGHT -> giveToThirdPlayer()
                MoneyDirection.CENTER -> giveToPot()
                MoneyDirection.STAY -> keepOwnMoney()
            }
        }

        val listOfPlayers = listOf(playerOne!!, playerTwo!!, playerThree!!)
        return TurnResults(
            listOfPlayers = listOfPlayers,
            turnNumber = turnNumber,
            potAmount = pot
        )
    }

    private fun giveToSecondPlayer() {
        playerTwo?.addMoney()
    }

    private fun giveToThirdPlayer() {
        playerThree?.addMoney()
    }

    private fun giveToPot() {
        pot += 1
    }

    private fun keepOwnMoney() {
        playerOne?.addMoney()
    }


    companion object {
        const val LEFT = 2
        const val CENTER = 3
        const val RIGHT = 4
    }

    enum class MoneyDirection {
        LEFT, RIGHT, CENTER, STAY
    }
}
